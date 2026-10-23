import { appendFile, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createUsageIndex } from "../../server/usage-index";
import { claudeTranscript, codexRollout } from "../fixtures/session-fixtures";

let base: string;
let root: string;
const slug = (path: string) => path.replace(/[^A-Za-z0-9]/g, "-");
const write = async (path: string, content: string) => { await mkdir(join(path, ".."), { recursive: true }); await writeFile(path, content, "utf8"); };
const response = (id: string, at: string, tokens: number, extra: Record<string, unknown> = {}) => JSON.stringify({ type: "assistant", cwd: root, timestamp: at, uuid: `u-${id}`, parentUuid: "p", message: { id, model: "claude-opus-5-5", usage: { input_tokens: tokens, output_tokens: 1 } }, ...extra });
const query = (overrides: Record<string, unknown> = {}) => ({ workspaceId: "selected", roots: [root], shipped: [] as [string, string][], current: "M002", budgetMs: 10_000, ...overrides });

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), "observer-usage-")));
  root = join(base, "work", "proj");
  await mkdir(root, { recursive: true });
  const claude = join(base, "claude", "projects");
  // A worktree inside the root, a sibling project whose folder shares the prefix, and an unrelated folder.
  await write(join(claude, slug(join(root, ".claude", "worktrees", "w1")), "t.jsonl"), claudeTranscript(join(root, ".claude", "worktrees", "w1")));
  await write(join(claude, slug(`${root}-other`), "t.jsonl"), claudeTranscript(`${root}-other`));
  await write(join(claude, "-unrelated", "t.jsonl"), claudeTranscript(root));
  await write(join(base, "codex", "2026", "09", "10", "a.jsonl"), codexRollout(root));
  await write(join(base, "codex", "2026", "09", "10", "other.jsonl"), codexRollout(join(base, "elsewhere")));
  await write(join(base, "daemon.json"), JSON.stringify({ prices: { "gpt-6-astra": { input: 100, cached: 10, output: 1000 }, broken: { input: "x" } } }));
});
afterEach(async () => { await rm(base, { recursive: true, force: true }); });

const index = (configPath = join(base, "daemon.json")) => createUsageIndex({ sessionDirs: [join(base, "codex"), join(base, "claude", "projects")], configPath });

describe("usage index", () => {
  it("counts sessions whose working directory is inside the root, priced from the daemon's table", async () => {
    const usage = await index().usage(query());
    expect(usage).toMatchObject({ availability: "available", complete: true, pricing: "configured", sessions: 2, unpriced: ["claude-sonnet-5"] });
    expect(usage.totals).toEqual({ turns: 4, prompts: 2, tokensIn: 600 + 2000 - 1500 + 100 + 5, tokensCached: 400 + 1500 + 300, tokensOut: 50 + 100 + 20 + 7, cost: 0.28, pricedTurns: 2, durationS: 60, timedTurns: 2 });
    expect(usage.models).toEqual([
      { model: "gpt-6-astra", host: "codex", turns: 2, tokens: 600 + 400 + 50 + 500 + 1500 + 100, cost: 0.28 },
      { model: "claude-sonnet-5", host: "claude", turns: 2, tokens: 100 + 300 + 20 + 5 + 7, cost: null },
    ]);
    expect(usage.milestones).toEqual([{ id: "M002", turns: 4, tokens: 3150 + 432, cost: 0.28 }]);
  });

  it("shows tokens without costs when no price table can be read", async () => {
    const usage = await index(join(base, "missing.json")).usage(query());
    expect(usage).toMatchObject({ pricing: "missing", totals: { cost: null, pricedTurns: 0 }, unpriced: ["claude-sonnet-5", "gpt-6-astra"] });
  });

  it("splits usage at each milestone's ship date, the rest going to the current milestone", async () => {
    const usage = await index().usage(query({ shipped: [["2026-09-05", "M001"], ["2026-08-01", "M000"]] }));
    // Claude turns on 2026-09-01 fall before M001's ship date; Codex turns on 2026-09-10 are after it.
    expect(usage.milestones).toEqual([{ id: "M001", turns: 2, tokens: 432, cost: null }, { id: "M002", turns: 2, tokens: 3150, cost: 0.28 }]);
    expect((await index().usage(query({ current: null }))).milestones).toEqual([{ id: null, turns: 4, tokens: 3582, cost: 0.28 }]);
  });

  it("counts a response repeated by a forked subagent transcript once", async () => {
    const folder = join(base, "claude", "projects", slug(root));
    await write(join(folder, "main.jsonl"), `${response("msg_1", "2026-10-01T10:00:00Z", 10)}\n`);
    await write(join(folder, "s1", "subagents", "agent.jsonl"), `${response("msg_1", "2026-10-01T10:00:00Z", 10)}\n${response("msg_2", "2026-10-01T10:00:05Z", 3)}\n`);
    expect((await index().usage(query())).totals.turns).toBe(6);
  });

  it("reads only appended lines, waits for a line still being written, and restarts a replaced file", async () => {
    const usageIndex = index();
    const file = join(base, "claude", "projects", slug(root), "live.jsonl");
    await write(file, `${response("m1", "2026-10-01T10:00:00Z", 10)}\n`);
    expect((await usageIndex.usage(query())).totals.turns).toBe(5);
    const second = response("m2", "2026-10-01T10:01:00Z", 20);
    await appendFile(file, second.slice(0, 40));
    expect((await usageIndex.usage(query())).totals.turns).toBe(5);
    await appendFile(file, `${second.slice(40)}\n`);
    expect((await usageIndex.usage(query())).totals).toMatchObject({ turns: 6, tokensIn: 1205 + 10 + 20 });
    await rm(file);
    await write(file, `${response("m3", "2026-10-01T10:02:00Z", 7)}\n`);
    expect((await usageIndex.usage(query())).totals).toMatchObject({ turns: 5, tokensIn: 1205 + 7 });
  });

  it("never follows a linked session file or folder", async () => {
    const outside = join(base, "outside");
    await write(join(outside, "t.jsonl"), `${response("x1", "2026-10-01T10:00:00Z", 99)}\n`);
    await symlink(join(outside, "t.jsonl"), join(base, "claude", "projects", slug(join(root, ".claude", "worktrees", "w1")), "linked.jsonl"));
    await symlink(outside, join(base, "claude", "projects", slug(join(root, "linked"))));
    expect((await index().usage(query())).totals.turns).toBe(4);
  });

  it("reports a read the deadline cut short as incomplete", async () => {
    const usage = await index().usage(query({ budgetMs: -1 }));
    expect(usage).toMatchObject({ complete: false, availability: "none" });
  });

  it("pages the turn ledger newest first, with agents, costs and no text", async () => {
    const ledger = await index().ledger({ ...query(), offset: 0, limit: 3, anchor: null });
    expect(ledger).toMatchObject({ availability: "available", complete: true, total: 4, offset: 0 });
    expect(ledger.records).toEqual([
      { at: "2026-09-10T10:01:01.000Z", agent: "$gsd-path-build · T006", host: "codex", model: "gpt-6-astra", tokensIn: 500, tokensCached: 1500, tokensOut: 100, durationS: 30, cost: 0.165 },
      { at: "2026-09-10T10:00:31.000Z", agent: "$gsd-path-build · T006", host: "codex", model: "gpt-6-astra", tokensIn: 600, tokensCached: 400, tokensOut: 50, durationS: 30, cost: 0.114 },
      { at: "2026-09-01T09:00:09.000Z", agent: "$gsd-path-plan · subagent", host: "claude", model: "claude-sonnet-5", tokensIn: 5, tokensCached: 0, tokensOut: 7, durationS: null, cost: null },
    ]);
    expect((await index().ledger({ ...query(), offset: 3, limit: 3, anchor: null })).records.map((record) => record.agent)).toEqual(["$gsd-path-plan"]);
    expect(JSON.stringify(ledger)).not.toMatch(/the thing|please|\/work\//);
  });

  it("reads a file reachable from overlapping session roots once", async () => {
    const usage = await createUsageIndex({ sessionDirs: [join(base, "codex"), `${join(base, "codex")}/`, join(base, "codex", "2026"), join(base, "claude", "projects")], configPath: join(base, "daemon.json") }).usage(query());
    expect(usage).toMatchObject({ sessions: 2, totals: { turns: 4 } });
  });

  it("resolves a session root reached through a link, as the user set it up", async () => {
    await symlink(join(base, "claude"), join(base, "linked-claude"));
    const usage = await createUsageIndex({ sessionDirs: [join(base, "linked-claude", "projects")], configPath: join(base, "daemon.json") }).usage(query());
    expect(usage).toMatchObject({ sessions: 1, totals: { turns: 2 } });
  });

  it("clamps a malformed count instead of losing the ledger page", async () => {
    await write(join(base, "claude", "projects", slug(root), "bad.jsonl"), `${response("bad", "2026-10-02T10:00:00Z", -5, { message: { id: "bad", model: "claude-opus-5-5", usage: { input_tokens: -5, output_tokens: 1e300 } } })}\n`);
    const ledger = await index().ledger({ ...query(), offset: 0, limit: 1, anchor: null });
    expect(ledger.records[0]).toMatchObject({ at: "2026-10-02T10:00:00Z", tokensIn: 0 });
    expect((await index().usage(query())).availability).toBe("available");
  });

  it("pages a stable ledger while a session keeps adding turns", async () => {
    const usageIndex = index();
    const first = await usageIndex.ledger({ ...query(), offset: 0, limit: 2, anchor: null });
    await write(join(base, "claude", "projects", slug(root), "live.jsonl"), `${response("new1", "2026-10-30T10:00:00Z", 1)}\n${response("new2", "2026-10-30T10:01:00Z", 1)}\n`);
    const second = await usageIndex.ledger({ ...query(), offset: 2, limit: 2, anchor: first.total });
    expect(second.total).toBe(4);
    expect([...first.records, ...second.records].map((record) => record.at)).toEqual(["2026-09-10T10:01:01.000Z", "2026-09-10T10:00:31.000Z", "2026-09-01T09:00:09.000Z", "2026-09-01T09:00:05.000Z"]);
  });

  it("keeps each valid rate of a price, as the daemon does, and leaves an empty price unpriced", async () => {
    await write(join(base, "daemon.json"), JSON.stringify({ prices: { "gpt-6-astra": { input: 100, cached: "x" }, "claude-sonnet-5": {} } }));
    const usage = await index().usage(query());
    expect(usage.models.find((model) => model.model === "gpt-6-astra")?.cost).toBe(0.11);
    expect(usage.unpriced).toEqual(["claude-sonnet-5"]);
  });

  it("reports no sessions for a root nothing ran in", async () => {
    const usage = await index().usage(query({ roots: [join(base, "nowhere")] }));
    expect(usage).toMatchObject({ availability: "none", complete: true, sessions: 0, totals: { turns: 0 } });
  });
});
