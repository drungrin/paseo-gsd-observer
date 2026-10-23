import { constants } from "node:fs";
import { lstat, open, opendir, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, sep } from "node:path";
import { TaskIdSchema } from "../shared/path.js";
import { ACTIVITY_BUCKET_MS, ACTIVITY_LIMIT, ActivityLaneSchema, PlanLaneSchema, BoardUsageSchema, LedgerPageSchema, LedgerRecordSchema, ModelNameSchema, type ActivityLane, type BoardUsage, type LedgerPage, type LedgerRecord, type UsageSlot } from "../shared/usage.js";
import { agentLabel, consumeLine, laneOf, costFor, newSessionState, roundHalfEven, type HostName, type HostRecord, type Price, type SessionFlavor, type SessionState, type SubagentMeta } from "./host-sessions.js";

/**
 * An in-memory index of host session logs, read the way the GSD Path daemon reads them. Session files live outside the
 * workspace: the configured session roots are used as the user set them up, but nothing inside them is read through a link or
 * read blocking, and only usage numbers are kept. Files are append-only logs: each read resumes where the last one stopped, so
 * a long-running session costs only its new lines. Every read, walk included, stops at the request's time budget.
 */

export const DEFAULT_SESSION_DIRS = ["~/.codex/sessions", "~/Library/Application Support/orca/codex-accounts/*/home/sessions", "~/AppData/Roaming/orca/codex-accounts/*/home/sessions", "~/.claude/projects"] as const;
const HEAD_BYTES = 65_536;
const CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_LINE_BYTES = 32 * 1024 * 1024;
const CONFIG_BYTES = 1024 * 1024;
const META_BYTES = 16 * 1024;
/** Claude Code writes a subagent's transcript as `<session>/subagents/agent-<id>.jsonl`, beside its `agent-<id>.meta.json`. */
const SUBAGENT_FILE = /[\\/]subagents[\\/]agent-[A-Za-z0-9_-]{1,64}\.jsonl$/;
// Per session root, so a large Codex history never starves the Claude projects folder.
const MAX_ENTRIES = 100_000;
const MAX_DEPTH = 6;
const CWD = /"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/;
const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

type FileEntry = { dev: number; ino: number; offset: number; skipping: boolean; state: SessionState };
type Head = { dev: number; ino: number; size: number; cwd: string | null };
/** `budgetMs` starts when the request's turn comes, not while it waits behind another workspace's. */
export type UsageQuery = { workspaceId: string; flavor: SessionFlavor; roots: readonly string[]; shipped: readonly (readonly [string, string])[]; current: string | null; budgetMs: number };
/** `anchor` is the total the first page reported: later pages page through those turns, so new ones never repeat a row. */
export type LedgerQuery = UsageQuery & { offset: number; limit: number; anchor: number | null };
export type UsageIndex = { usage(query: UsageQuery): Promise<BoardUsage>; ledger(query: LedgerQuery): Promise<LedgerPage> };
type Config = { prices: Map<string, Price>; pricing: BoardUsage["pricing"]; sessionDirs: readonly string[] };
type Collected = { complete: boolean; limited: boolean; sessions: number; records: (HostRecord & { agent: string; lane: string })[]; config: Config };

const expandHome = (pattern: string) => pattern === "~" ? homedir() : pattern.startsWith("~/") ? join(homedir(), pattern.slice(2)) : pattern;
const isUnder = (path: string, root: string) => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);
/** Claude Code names a project folder after its working directory with every other character replaced by "-". */
const claudeSlug = (root: string) => root.replace(/[^A-Za-z0-9]/g, "-");

/** The daemon's `_prices`: each valid rate is kept and a missing one costs nothing; a model with no valid rate has no price. */
const price = (value: unknown): Price | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rates = ["input", "cached", "output"].map((key) => { const number = (value as Record<string, unknown>)[key]; return typeof number === "number" && Number.isFinite(number) && number >= 0 ? number : null; });
  return rates.some((rate) => rate !== null) ? { input: rates[0] ?? 0, cached: rates[1] ?? 0, output: rates[2] ?? 0 } : null;
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

/**
 * Session roots matching a pattern with `~` and `*` segments, as real folders. A root that is itself reached through a link (a
 * dotfiles setup linking `~/.claude`) is the user's configuration and is resolved; `*` matches only real folders.
 */
async function expand(pattern: string): Promise<string[]> {
  const parts = expandHome(pattern).split(/[\\/]/);
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
  for (const base of bases) {
    const resolved = await realpath(base).catch(() => null);
    if (resolved && (await lstat(resolved).catch(() => null))?.isDirectory() && !real.includes(resolved)) real.push(resolved);
  }
  return real;
}

type Walked = { files: string[]; limited: boolean; timedOut: boolean };

/**
 * Session files under a root. In Claude Code's `projects` folder only the folders named after a root, or after a path inside
 * it, are walked; the working directory each file records still decides whether it belongs to the root. No link is followed,
 * and a folder replaced while it was listed is left out.
 */
async function sessionFiles(base: string, roots: readonly string[], deadline: number): Promise<Walked> {
  const walked: Walked = { files: [], limited: false, timedOut: false };
  const slugs = roots.map(claudeSlug);
  const claude = basename(base) === "projects";
  let entries = MAX_ENTRIES;
  const walk = async (folder: string, depth: number) => {
    if (depth > MAX_DEPTH || walked.limited || walked.timedOut) return;
    if (Date.now() > deadline) { walked.timedOut = true; return; }
    const before = await lstat(folder).catch(() => null);
    if (!before?.isDirectory() || before.isSymbolicLink()) return;
    const files: string[] = [];
    const folders: string[] = [];
    const directory = await opendir(folder).catch(() => null);
    if (!directory) return;
    for await (const entry of directory) {
      if (--entries < 0) { walked.limited = true; break; }
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && !(depth === 0 && claude && !slugs.some((slug) => entry.name === slug || entry.name.startsWith(`${slug}-`)))) folders.push(join(folder, entry.name));
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(join(folder, entry.name));
    }
    const after = await lstat(folder).catch(() => null);
    if (!after || after.isSymbolicLink() || after.dev !== before.dev || after.ino !== before.ino) return;
    walked.files.push(...files);
    for (const child of folders) await walk(child, depth + 1);
  };
  await walk(base, 0);
  return walked;
}

export function createUsageIndex({ sessionDirs, configPath = process.env.GSD_DAEMON_CONFIG ?? join(homedir(), ".gsd-path", "daemon.json") }: { sessionDirs?: readonly string[]; configPath?: string } = {}): UsageIndex {
  // A log is read once per flavor: a GSD Path and a GSD Core workspace reading the same file each keep their own marks.
  const entries = new Map<string, FileEntry>();
  const key = (path: string, flavor: SessionFlavor) => `${flavor}\0${path}`;
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

  /** The role and task Claude Code recorded for a subagent transcript; only those two strings are kept. */
  async function subagentMeta(path: string): Promise<SubagentMeta | null> {
    if (!SUBAGENT_FILE.test(path)) return null;
    const handle = await open(path.replace(/\.jsonl$/, ".meta.json"), flags).catch(() => null);
    if (!handle) return null;
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > META_BYTES) return null;
      const buffer = Buffer.alloc(stat.size);
      const { bytesRead } = await handle.read(buffer, 0, stat.size, 0);
      const value = JSON.parse(buffer.toString("utf8", 0, bytesRead)) as Record<string, unknown>;
      const field = (key: string) => typeof value[key] === "string" ? (value[key] as string).slice(0, 200) : null;
      return { role: field("agentType"), description: field("description") };
    } catch { return null; } finally { await handle.close().catch(() => undefined); }
  }

  /** Reads the lines appended since the last read; false when the deadline stopped it first. */
  async function advance(path: string, deadline: number, flavor: SessionFlavor): Promise<boolean> {
    const handle = await open(path, flags).catch(() => null);
    if (!handle) return true;
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) return true;
      let entry = entries.get(key(path, flavor));
      // A replaced or truncated file is a new log.
      if (!entry || entry.dev !== stat.dev || entry.ino !== stat.ino || stat.size < entry.offset) {
        const meta = flavor === "gsd-core" ? await subagentMeta(path) : null;
        entries.set(key(path, flavor), entry = { dev: stat.dev, ino: stat.ino, offset: 0, skipping: false, state: newSessionState(flavor, meta) });
      }
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

  async function collect(roots: readonly string[], budgetMs: number, flavor: SessionFlavor): Promise<Collected> {
    const deadline = Date.now() + budgetMs;
    const config = await readConfig(configPath);
    let complete = true;
    let limited = false;
    let sessions = 0;
    const matched: string[] = [];
    const visited = new Set<string>();
    for (const pattern of sessionDirs ?? config.sessionDirs) {
      for (const base of await expand(pattern)) {
        const claude = basename(base) === "projects";
        const walked = await sessionFiles(base, roots, deadline);
        limited ||= walked.limited;
        if (walked.timedOut) complete = false;
        for (const path of walked.files) {
          // Overlapping session roots ("~/.codex" and "~/.codex/sessions") reach the same file once.
          if (visited.has(path)) continue;
          visited.add(path);
          const late = Date.now() > deadline;
          if (late) complete = false;
          // Past the deadline only what is already known counts; nothing new is read.
          const cwd = entries.get(key(path, flavor))?.state.cwd ?? (late ? heads.get(path)?.cwd ?? null : await headCwd(path));
          // A Claude transcript in a matching folder may name its cwd after the head; it is read to find out.
          if (cwd ? !roots.some((root) => isUnder(cwd, root)) : !claude) continue;
          matched.push(path);
          if (!late && !await advance(path, deadline, flavor)) complete = false;
        }
      }
    }
    const seen = new Set<string>();
    const records: Collected["records"] = [];
    for (const path of matched) {
      const entry = entries.get(key(path, flavor));
      const cwd = entry?.state.cwd ?? heads.get(path)?.cwd;
      if (!entry || !cwd || !roots.some((root) => isUnder(cwd, root))) continue;
      sessions += 1;
      for (const record of entry.state.records) {
        // Subagent transcripts forked from one context repeat the same responses.
        if (record.id) { if (seen.has(record.id)) continue; seen.add(record.id); }
        records.push({ ...record, agent: agentLabel(entry.state, record), lane: laneOf(entry.state, record) });
      }
    }
    records.sort((left, right) => (left.at ?? "").localeCompare(right.at ?? ""));
    return { complete, limited, sessions, records, config };
  }

  // Claude Code labels its own zero-token messages "<synthetic>"; the brackets are not part of a model name.
  const model = (value: string | null) => { const name = value === "<synthetic>" ? "synthetic" : value; return name && ModelNameSchema.safeParse(name).success ? name : null; };
  const slot = (): UsageSlot & { priced: number } => ({ turns: 0, tokens: 0, cost: 0, priced: 0 });
  const add = (target: UsageSlot & { priced: number }, tokens: number, cost: number | null) => { target.turns += 1; target.tokens += tokens; if (cost !== null) { target.cost = (target.cost ?? 0) + cost; target.priced += 1; } };
  const finish = ({ priced, ...value }: UsageSlot & { priced: number }): UsageSlot => ({ ...value, cost: priced ? roundHalfEven(value.cost ?? 0, 2) : null });

  type Span = UsageSlot & { priced: number; durationS: number; first: number; last: number };
  /** Each task's or plan's usage, with its first and last turn time, in id order; plan numbers compare as numbers ("61-10" after "61-9"). */
  const spans = (map: ReadonlyMap<string, Span>, numeric = false) => [...map].sort(([left], [right]) => numeric ? left.localeCompare(right, "en", { numeric: true }) : left.localeCompare(right)).slice(0, 512)
    .map(([id, { durationS, first, last, ...value }]) => ({ id, ...finish(value), durationS: roundHalfEven(durationS, 1), first: Number.isFinite(first) ? new Date(first).toISOString() : null, last: Number.isFinite(last) ? new Date(last).toISOString() : null }));

  /** The daemon's `spend_for`: a record dated on or before a milestone's ship date belongs to the earliest such milestone, later ones to the current milestone. */
  function summarize(query: UsageQuery, collected: Collected): BoardUsage {
    const { records, config } = collected;
    const shipped = [...query.shipped].sort(([left], [right]) => left.localeCompare(right));
    const totals = { turns: 0, prompts: 0, tokensIn: 0, tokensCached: 0, tokensOut: 0, cost: 0, pricedTurns: 0, durationS: 0, timedTurns: 0 };
    const prompts = new Set<string | null>();
    const models = new Map<string, UsageSlot & { priced: number; model: string | null; host: HostName }>();
    const milestones = new Map<string | null, UsageSlot & { priced: number }>();
    const unpriced: string[] = [];
    const tasks = new Map<string, UsageSlot & { priced: number; durationS: number; first: number; last: number }>();
    const plans = new Map<string, UsageSlot & { priced: number; durationS: number; first: number; last: number }>();
    const phases = new Map<string, UsageSlot & { priced: number; durationS: number }>();
    const core = query.flavor === "gsd-core";
    const activity = new Map<string, { lane: ActivityLane; at: string; turns: number; cost: number; priced: number }>();
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
      // GSD Core records no ship dates, so its usage is split by plan and phase instead of by milestone.
      if (!core) {
        const milestone = (day ? shipped.find(([date]) => day <= date)?.[1] : undefined) ?? query.current;
        const milestoneSlot = milestones.get(milestone) ?? slot();
        milestones.set(milestone, milestoneSlot);
        add(milestoneSlot, tokens, cost);
      }
      // A task id the schema cannot carry (more than six digits) counts with the other subagents.
      const lane: ActivityLane = ActivityLaneSchema.safeParse(record.lane).success && (record.lane === "orchestrator" || record.lane === "subagents" || (core ? !TaskIdSchema.safeParse(record.lane).success : TaskIdSchema.safeParse(record.lane).success))
        ? record.lane as ActivityLane : "subagents";
      // Times are compared as instants and written in one form; a timestamp that does not parse places the turn nowhere.
      const time = record.at ? Date.parse(record.at) : NaN;
      if (lane !== "orchestrator" && lane !== "subagents") {
        // A GSD Core lane is a plan ("61-3") or a phase ("61"); a plan's turns also count toward its phase.
        const plan = core && PlanLaneSchema.safeParse(lane).success;
        const spans = core ? plan ? plans : null : tasks;
        if (spans) {
          const spanSlot = spans.get(lane) ?? { ...slot(), durationS: 0, first: Infinity, last: -Infinity };
          spans.set(lane, spanSlot);
          add(spanSlot, tokens, cost);
          spanSlot.durationS += record.durationS ?? 0;
          if (Number.isFinite(time)) { spanSlot.first = Math.min(spanSlot.first, time); spanSlot.last = Math.max(spanSlot.last, time); }
        }
        if (core) {
          const phase = plan ? lane.slice(0, lane.lastIndexOf("-")) : lane;
          const phaseSlot = phases.get(phase) ?? { ...slot(), durationS: 0 };
          phases.set(phase, phaseSlot);
          add(phaseSlot, tokens, cost);
          phaseSlot.durationS += record.durationS ?? 0;
        }
      }
      if (Number.isFinite(time)) {
        const at = new Date(Math.floor(time / ACTIVITY_BUCKET_MS) * ACTIVITY_BUCKET_MS).toISOString();
        const bucket = activity.get(`${lane}|${at}`) ?? { lane, at, turns: 0, cost: 0, priced: 0 };
        activity.set(`${lane}|${at}`, bucket);
        bucket.turns += 1;
        if (cost !== null) { bucket.cost += cost; bucket.priced += 1; }
      }
    }
    totals.prompts = prompts.size;
    const buckets = [...activity.values()].sort((left, right) => right.at.localeCompare(left.at)).slice(0, ACTIVITY_LIMIT)
      .sort((left, right) => left.at.localeCompare(right.at) || left.lane.localeCompare(right.lane));
    const usage: BoardUsage = {
      workspaceId: query.workspaceId, observedAt: new Date().toISOString(), availability: records.length ? "available" : "none", complete: collected.complete, limited: collected.limited,
      pricing: config.pricing, sessions: collected.sessions,
      totals: { ...totals, cost: totals.pricedTurns ? roundHalfEven(totals.cost, 2) : null, durationS: roundHalfEven(totals.durationS, 1) },
      models: [...models.values()].sort((left, right) => right.tokens - left.tokens).slice(0, 64).map(({ model: name, host, ...value }) => ({ model: name, host, ...finish(value) })),
      milestones: [...milestones].filter(([id]) => id === null || /^M\d{3,6}$/.test(id)).slice(0, 129).map(([id, value]) => ({ id, ...finish(value) })),
      unpriced: unpriced.slice(0, 32),
      tasks: spans(tasks),
      plans: spans(plans, true),
      phases: [...phases].sort(([left], [right]) => left.localeCompare(right, "en", { numeric: true })).slice(0, 256)
        .map(([id, { durationS, ...value }]) => ({ id, ...finish(value), durationS: roundHalfEven(durationS, 1) })),
      activity: buckets.map(({ lane, at, turns, cost, priced }) => ({ lane, at, turns, cost: priced ? roundHalfEven(cost, 4) : null })),
      activityLimited: activity.size > ACTIVITY_LIMIT,
    };
    return BoardUsageSchema.parse(usage);
  }

  /** One turn for the wire; a field the schema refuses is dropped on its own, never the whole page. */
  const ledgerRecord = (record: Collected["records"][number], prices: Config["prices"]): LedgerRecord => {
    const cost = costFor(prices, record.model, record.tokensIn, record.tokensCached, record.tokensOut);
    const value: LedgerRecord = { at: record.at, agent: record.agent, host: record.host, model: model(record.model), tokensIn: record.tokensIn, tokensCached: record.tokensCached, tokensOut: record.tokensOut, durationS: record.durationS, cost: cost === null ? null : roundHalfEven(cost, 4) };
    if (LedgerRecordSchema.safeParse(value).success) return value;
    const { shape } = LedgerRecordSchema;
    const valid = <K extends keyof LedgerRecord>(key: K, fallback: LedgerRecord[K]) => shape[key].safeParse(value[key]).success ? value[key] : fallback;
    return { at: valid("at", null), agent: valid("agent", record.host), host: record.host, model: valid("model", null), tokensIn: valid("tokensIn", 0), tokensCached: valid("tokensCached", 0), tokensOut: valid("tokensOut", 0), durationS: valid("durationS", null), cost: valid("cost", null) };
  };

  return {
    usage: (query) => exclusive(async () => summarize(query, await collect(query.roots, query.budgetMs, query.flavor))),
    ledger: (query) => exclusive(async () => {
      const collected = await collect(query.roots, query.budgetMs, query.flavor);
      // Turns are in time order and new ones append, so the first `anchor` turns are the set the first page saw.
      const anchored = query.anchor === null ? collected.records : collected.records.slice(0, query.anchor);
      const newest = anchored.slice().reverse();
      return LedgerPageSchema.parse({
        workspaceId: query.workspaceId, availability: newest.length ? "available" : "none", complete: collected.complete, total: newest.length, offset: query.offset,
        records: newest.slice(query.offset, query.offset + query.limit).map((record) => ledgerRecord(record, collected.config.prices)),
      });
    }),
  };
}
