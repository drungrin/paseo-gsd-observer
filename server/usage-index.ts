import { constants } from "node:fs";
import { lstat, open, opendir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, sep } from "node:path";
import { BoardUsageSchema, LedgerPageSchema, LedgerRecordSchema, ModelNameSchema, type BoardUsage, type LedgerPage, type LedgerRecord, type UsageSlot } from "../shared/usage.js";
import { agentLabel, consumeLine, costFor, newSessionState, roundHalfEven, type HostName, type HostRecord, type Price, type SessionState } from "./host-sessions.js";

/**
 * An in-memory index of host session logs, read the way the GSD Path daemon reads them. Session files live outside the
 * workspace, so they are opened read-only without following links or blocking, and only their usage numbers are kept. Files are
 * append-only logs: each read resumes where the last one stopped, so a long-running session costs only its new lines.
 */

export const DEFAULT_SESSION_DIRS = ["~/.codex/sessions", "~/Library/Application Support/orca/codex-accounts/*/home/sessions", "~/AppData/Roaming/orca/codex-accounts/*/home/sessions", "~/.claude/projects"] as const;
const HEAD_BYTES = 65_536;
const CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_LINE_BYTES = 32 * 1024 * 1024;
const CONFIG_BYTES = 1024 * 1024;
const MAX_ENTRIES = 100_000;
const MAX_DEPTH = 6;
const CWD = /"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/;
const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

type FileEntry = { dev: number; ino: number; offset: number; skipping: boolean; state: SessionState };
type Head = { dev: number; ino: number; size: number; cwd: string | null };
export type UsageQuery = { workspaceId: string; roots: readonly string[]; shipped: readonly (readonly [string, string])[]; current: string | null; deadline: number };
export type UsageIndex = { usage(query: UsageQuery): Promise<BoardUsage>; ledger(query: UsageQuery & { offset: number; limit: number }): Promise<LedgerPage> };
type Config = { prices: Map<string, Price>; pricing: BoardUsage["pricing"]; sessionDirs: readonly string[] };
type Collected = { complete: boolean; sessions: number; records: (HostRecord & { agent: string })[]; config: Config };

const expandHome = (pattern: string) => pattern === "~" ? homedir() : pattern.startsWith("~/") ? join(homedir(), pattern.slice(2)) : pattern;
const isUnder = (path: string, root: string) => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);
/** Claude Code names a project folder after its working directory with every other character replaced by "-". */
const claudeSlug = (root: string) => root.replace(/[^A-Za-z0-9]/g, "-");

const price = (value: unknown): Price | null => {
  if (!value || typeof value !== "object") return null;
  const rate = (key: string) => { const number = (value as Record<string, unknown>)[key] ?? 0; return typeof number === "number" && Number.isFinite(number) && number >= 0 ? number : null; };
  const [input, cached, output] = [rate("input"), rate("cached"), rate("output")];
  return input === null || cached === null || output === null ? null : { input, cached, output };
};

/** The daemon's price table and session folders from its config file, read as data; a missing table prices nothing. */
async function readConfig(path: string): Promise<Config> {
  const fallback: Config = { prices: new Map(), pricing: "missing", sessionDirs: DEFAULT_SESSION_DIRS };
  const stat = await lstat(path).catch(() => null);
  if (!stat?.isFile() || stat.size > CONFIG_BYTES) return fallback;
  let data: unknown;
  try { data = JSON.parse(await readFile(path, { encoding: "utf8", flag: flags })); } catch { return fallback; }
  if (!data || typeof data !== "object") return fallback;
  const { prices, session_dirs: dirs } = data as { prices?: unknown; session_dirs?: unknown };
  const table = new Map<string, Price>();
  if (prices && typeof prices === "object") for (const [model, value] of Object.entries(prices)) { const rate = price(value); if (rate) table.set(model, rate); }
  return { prices: table, pricing: table.size ? "configured" : "missing", sessionDirs: Array.isArray(dirs) && dirs.every((dir) => typeof dir === "string") ? dirs : DEFAULT_SESSION_DIRS };
}

/** Folders matching a pattern with `~` and `*` segments; links are never followed. */
async function expand(pattern: string): Promise<string[]> {
  const absolute = expandHome(pattern);
  const parts = absolute.split(/[\\/]/);
  let bases = [parts[0] ? `${parts[0]}${sep}` : sep];
  for (const part of parts.slice(1).filter(Boolean)) {
    const next: string[] = [];
    for (const base of bases) {
      if (!part.includes("*")) { next.push(join(base, part)); continue; }
      const matcher = new RegExp(`^${part.split("*").map((piece) => piece.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
      const directory = await opendir(base).catch(() => null);
      if (!directory) continue;
      for await (const entry of directory) if (entry.isDirectory() && matcher.test(entry.name)) next.push(join(base, entry.name));
    }
    bases = next;
  }
  const real: string[] = [];
  for (const base of bases) if ((await lstat(base).catch(() => null))?.isDirectory()) real.push(base);
  return real;
}

/**
 * Session files under a folder. In Claude Code's `projects` folder only the folders named after a root, or after a path inside
 * it, are walked; the working directory each file records still decides whether it belongs to the root.
 */
async function sessionFiles(base: string, roots: readonly string[], budget: { entries: number }): Promise<string[]> {
  const files: string[] = [];
  const slugs = roots.map(claudeSlug);
  const claude = basename(base) === "projects";
  const walk = async (folder: string, depth: number) => {
    if (depth > MAX_DEPTH) return;
    const directory = await opendir(folder).catch(() => null);
    if (!directory) return;
    for await (const entry of directory) {
      if (--budget.entries < 0) break;
      if (entry.isSymbolicLink()) continue;
      const path = join(folder, entry.name);
      if (entry.isDirectory()) {
        if (depth === 0 && claude && !slugs.some((slug) => entry.name === slug || entry.name.startsWith(`${slug}-`))) continue;
        await walk(path, depth + 1);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
    }
  };
  await walk(base, 0);
  return files;
}

export function createUsageIndex({ sessionDirs, configPath = process.env.GSD_DAEMON_CONFIG ?? join(homedir(), ".gsd-path", "daemon.json") }: { sessionDirs?: readonly string[]; configPath?: string } = {}): UsageIndex {
  const entries = new Map<string, FileEntry>();
  const heads = new Map<string, Head>();
  let queue: Promise<unknown> = Promise.resolve();
  // One scan at a time: entries are shared by every workspace the server observes.
  const exclusive = <T>(work: () => Promise<T>): Promise<T> => { const run = queue.then(work, work); queue = run.catch(() => undefined); return run; };

  async function headCwd(path: string): Promise<string | null> {
    const stat = await lstat(path).catch(() => null);
    if (!stat?.isFile()) return null;
    const known = heads.get(path);
    // A head without a cwd is read again only when the file has grown, as the daemon does.
    if (known && known.dev === stat.dev && known.ino === stat.ino && (known.cwd !== null || known.size === stat.size)) return known.cwd;
    const handle = await open(path, flags).catch(() => null);
    if (!handle) return null;
    try {
      const buffer = Buffer.alloc(HEAD_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0);
      const match = CWD.exec(buffer.toString("utf8", 0, bytesRead));
      let cwd: string | null = null;
      if (match) { try { cwd = JSON.parse(`"${match[1]}"`) as string; } catch { cwd = match[1]; } }
      heads.set(path, { dev: stat.dev, ino: stat.ino, size: stat.size, cwd });
      return cwd;
    } catch { return null; } finally { await handle.close().catch(() => undefined); }
  }

  /** Reads the lines appended since the last read; false when the deadline stopped it first. */
  async function advance(path: string, deadline: number): Promise<boolean> {
    const handle = await open(path, flags).catch(() => null);
    if (!handle) return true;
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) return true;
      let entry = entries.get(path);
      // A replaced or truncated file is a new log.
      if (!entry || entry.dev !== stat.dev || entry.ino !== stat.ino || stat.size < entry.offset) entries.set(path, entry = { dev: stat.dev, ino: stat.ino, offset: 0, skipping: false, state: newSessionState() });
      let carry = Buffer.alloc(0);
      while (entry.offset + carry.length < stat.size) {
        if (Date.now() > deadline) return false;
        const length = Math.min(CHUNK_BYTES, stat.size - entry.offset - carry.length);
        const chunk = Buffer.allocUnsafe(length);
        const { bytesRead } = await handle.read(chunk, 0, length, entry.offset + carry.length);
        if (!bytesRead) break;
        const data = carry.length ? Buffer.concat([carry, chunk.subarray(0, bytesRead)]) : chunk.subarray(0, bytesRead);
        let start = 0;
        for (let newline = data.indexOf(10); newline >= 0; newline = data.indexOf(10, start)) {
          // An oversized line is dropped whole, never held in memory.
          if (entry.skipping) entry.skipping = false;
          else consumeLine(entry.state, data.toString("utf8", start, newline));
          start = newline + 1;
        }
        entry.offset += start;
        carry = data.subarray(start);
        if (carry.length > MAX_LINE_BYTES) { entry.offset += carry.length; carry = Buffer.alloc(0); entry.skipping = true; }
      }
      // A last line without a newline counts once it is complete JSON; a line still being written is read next time.
      if (carry.length && !entry.skipping) {
        const line = carry.toString("utf8");
        let complete = false;
        try { JSON.parse(line); complete = true; } catch { /* still being written */ }
        if (complete) { consumeLine(entry.state, line); entry.offset += carry.length; }
      }
      return true;
    } catch { return true; } finally { await handle.close().catch(() => undefined); }
  }

  async function collect(roots: readonly string[], deadline: number): Promise<Collected> {
    const config = await readConfig(configPath);
    const budget = { entries: MAX_ENTRIES };
    let complete = true;
    let sessions = 0;
    const matched: string[] = [];
    for (const pattern of sessionDirs ?? config.sessionDirs) {
      for (const base of await expand(pattern)) {
        for (const path of await sessionFiles(base, roots, budget)) {
          const parsed = entries.get(path)?.state.cwd;
          const cwd = parsed ?? await headCwd(path);
          const claude = basename(base) === "projects";
          // A Claude transcript in a matching folder may name its cwd after the head; it is read to find out.
          if (cwd ? !roots.some((root) => isUnder(cwd, root)) : !claude) continue;
          if (!complete) { matched.push(path); continue; }
          if (!await advance(path, deadline)) complete = false;
          matched.push(path);
        }
      }
    }
    if (budget.entries < 0) complete = false;
    const seen = new Set<string>();
    const records: Collected["records"] = [];
    for (const path of matched) {
      const entry = entries.get(path);
      const cwd = entry?.state.cwd ?? heads.get(path)?.cwd;
      if (!entry || !cwd || !roots.some((root) => isUnder(cwd, root))) continue;
      sessions += 1;
      for (const record of entry.state.records) {
        // Subagent transcripts forked from one context repeat the same responses.
        if (record.id) { if (seen.has(record.id)) continue; seen.add(record.id); }
        records.push({ ...record, agent: agentLabel(entry.state, record) });
      }
    }
    records.sort((left, right) => (left.at ?? "").localeCompare(right.at ?? ""));
    return { complete, sessions, records, config };
  }

  // Claude Code labels its own zero-token messages "<synthetic>"; the brackets are not part of a model name.
  const model = (value: string | null) => { const name = value === "<synthetic>" ? "synthetic" : value; return name && ModelNameSchema.safeParse(name).success ? name : null; };
  const slot = (): UsageSlot & { priced: number } => ({ turns: 0, tokens: 0, cost: 0, priced: 0 });
  const add = (target: UsageSlot & { priced: number }, tokens: number, cost: number | null) => { target.turns += 1; target.tokens += tokens; if (cost !== null) { target.cost = (target.cost ?? 0) + cost; target.priced += 1; } };
  const finish = ({ priced, ...value }: UsageSlot & { priced: number }): UsageSlot => ({ ...value, cost: priced ? roundHalfEven(value.cost ?? 0, 2) : null });

  /** The daemon's `spend_for`: a record dated on or before a milestone's ship date belongs to the earliest such milestone, later ones to the current milestone. */
  function summarize(query: UsageQuery, collected: Collected): BoardUsage {
    const { records, config } = collected;
    const shipped = [...query.shipped].sort(([left], [right]) => left.localeCompare(right));
    const totals = { turns: 0, prompts: 0, tokensIn: 0, tokensCached: 0, tokensOut: 0, cost: 0, pricedTurns: 0, durationS: 0, timedTurns: 0 };
    const prompts = new Set<string | null>();
    const models = new Map<string, UsageSlot & { priced: number; model: string | null; host: HostName }>();
    const milestones = new Map<string | null, UsageSlot & { priced: number }>();
    const unpriced: string[] = [];
    for (const record of records) {
      const cost = costFor(config.prices, record.model, record.tokensIn, record.tokensCached, record.tokensOut);
      const tokens = record.tokensIn + record.tokensCached + record.tokensOut;
      totals.turns += 1;
      prompts.add(record.turn);
      totals.tokensIn += record.tokensIn; totals.tokensCached += record.tokensCached; totals.tokensOut += record.tokensOut;
      if (record.durationS !== null) { totals.durationS += record.durationS; totals.timedTurns += 1; }
      // A model without a price is noted only when its turns used tokens; Claude Code's synthetic messages use none.
      if (cost === null) { const name = model(record.model); if (name && tokens && !unpriced.includes(name)) unpriced.push(name); }
      else { totals.cost += cost; totals.pricedTurns += 1; }
      const key = record.model ?? "unknown";
      const modelSlot = models.get(key) ?? { ...slot(), model: model(record.model), host: record.host };
      models.set(key, modelSlot);
      add(modelSlot, tokens, cost);
      const day = (record.at ?? "").slice(0, 10);
      const milestone = (day ? shipped.find(([date]) => day <= date)?.[1] : undefined) ?? query.current;
      const milestoneSlot = milestones.get(milestone) ?? slot();
      milestones.set(milestone, milestoneSlot);
      add(milestoneSlot, tokens, cost);
    }
    totals.prompts = prompts.size;
    const usage: BoardUsage = {
      workspaceId: query.workspaceId, observedAt: new Date().toISOString(), availability: records.length ? "available" : "none", complete: collected.complete,
      pricing: config.pricing, sessions: collected.sessions,
      totals: { ...totals, cost: totals.pricedTurns ? roundHalfEven(totals.cost, 2) : null, durationS: roundHalfEven(totals.durationS, 1) },
      models: [...models.values()].sort((left, right) => right.tokens - left.tokens).slice(0, 64).map(({ model: name, host, ...value }) => ({ model: name, host, ...finish(value) })),
      milestones: [...milestones].filter(([id]) => id === null || /^M\d{3,6}$/.test(id)).slice(0, 129).map(([id, value]) => ({ id, ...finish(value) })),
      unpriced: unpriced.slice(0, 32),
    };
    return BoardUsageSchema.parse(usage);
  }

  const ledgerRecord = (record: Collected["records"][number], prices: Config["prices"]): LedgerRecord => {
    const cost = costFor(prices, record.model, record.tokensIn, record.tokensCached, record.tokensOut);
    const value: LedgerRecord = { at: record.at, agent: record.agent, host: record.host, model: model(record.model), tokensIn: record.tokensIn, tokensCached: record.tokensCached, tokensOut: record.tokensOut, durationS: record.durationS, cost: cost === null ? null : roundHalfEven(cost, 4) };
    if (LedgerRecordSchema.safeParse(value).success) return value;
    return { ...value, at: LedgerRecordSchema.shape.at.safeParse(value.at).success ? value.at : null, agent: record.host };
  };

  return {
    usage: (query) => exclusive(async () => summarize(query, await collect(query.roots, query.deadline))),
    ledger: (query) => exclusive(async () => {
      const collected = await collect(query.roots, query.deadline);
      const newest = collected.records.slice().reverse();
      return LedgerPageSchema.parse({
        workspaceId: query.workspaceId, availability: newest.length ? "available" : "none", complete: collected.complete, total: newest.length, offset: query.offset,
        records: newest.slice(query.offset, query.offset + query.limit).map((record) => ledgerRecord(record, collected.config.prices)),
      });
    }),
  };
}
