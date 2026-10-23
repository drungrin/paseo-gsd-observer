import { describe, expect, it } from "vitest";
import { agentLabel, consumeLine, costFor, laneOf, newSessionState, roundHalfEven } from "../../server/host-sessions";
import { claudeTranscript, codexRollout, codexWorker, coreCodexWorker, coreOrchestrator, coreSubagent } from "../fixtures/session-fixtures";

const parse = (text: string) => { const state = newSessionState(); for (const line of text.split("\n")) consumeLine(state, line); return state; };

describe("host session parsing, as the GSD Path daemon parses it", () => {
  it("reads Codex records with model, agent, tokens and duration", () => {
    const state = parse(codexRollout("/work/proj"));
    expect(state.cwd).toBe("/work/proj");
    expect(state.records).toHaveLength(2);
    const [first, second] = state.records;
    expect(first).toMatchObject({ model: "gpt-6-astra", host: "codex", tokensIn: 600, tokensCached: 400, tokensOut: 50, durationS: 30 });
    expect(agentLabel(state, first)).toBe("$gsd-path-build · T006");
    expect(second.durationS).toBe(30);
  });

  it("counts Claude cache writes as input and marks subagents", () => {
    const state = parse(claudeTranscript("/work/proj/sub"));
    expect(state.cwd).toBe("/work/proj/sub");
    expect(state.records.map((record) => record.tokensIn)).toEqual([100, 5]);
    expect(state.records[0]).toMatchObject({ tokensCached: 300, host: "claude", durationS: null });
    expect(state.records.map((record) => agentLabel(state, record))).toEqual(["$gsd-path-plan", "$gsd-path-plan · subagent"]);
  });

  it("counts one Claude response once, with its final usage and its request time", () => {
    const state = parse([
      { type: "user", cwd: "/work/proj", timestamp: "2026-10-21T12:00:00.000Z", uuid: "u1", message: { role: "user", content: "$gsd-path-build T009" } },
      { type: "api-request", id: "r1", timestamp: "2026-10-21T12:00:01.000Z" },
      { type: "assistant", cwd: "/work/proj", timestamp: "2026-10-21T12:00:09.000Z", uuid: "a1", parentUuid: "u1", requestRef: "r1", message: { id: "msg_1", model: "claude-opus-5-5", usage: { input_tokens: 3, cache_creation_input_tokens: 7, cache_read_input_tokens: 500, output_tokens: 1 } } },
      { type: "assistant", cwd: "/work/proj", timestamp: "2026-10-21T12:00:13.500Z", uuid: "a2", parentUuid: "a1", requestRef: "r1", message: { id: "msg_1", model: "claude-opus-5-5", usage: { input_tokens: 3, cache_creation_input_tokens: 7, cache_read_input_tokens: 500, output_tokens: 40 } } },
      { type: "assistant", cwd: "/work/proj", timestamp: "2026-10-21T12:00:20.000Z", uuid: "a3", parentUuid: "a2", requestRef: "missing", message: { id: "msg_2", model: "claude-opus-5-5", usage: { input_tokens: 1, output_tokens: 2 } } },
    ].map((line) => JSON.stringify(line)).join("\n"));
    expect(state.records.map((record) => record.id)).toEqual(["msg_1", "msg_2"]);
    const [first, second] = state.records;
    expect(first).toMatchObject({ tokensIn: 10, tokensCached: 500, tokensOut: 40, at: "2026-10-21T12:00:13.500Z", turn: "u1", durationS: 12.5 });
    expect(agentLabel(state, first)).toBe("$gsd-path-build · T009");
    expect(second.durationS).toBeNull();
  });

  it("puts a subagent's turns in its task's lane, and every session nobody spawned in the orchestrator's", () => {
    const worker = parse(codexWorker("/work/proj"));
    expect(worker).toMatchObject({ spawned: true, task: "T007" });
    expect(worker.records.map((record) => laneOf(worker, record))).toEqual(["T007", "T007"]);
    // The daemon labels a spawned Codex thread like any other; only the lane tells them apart.
    expect(agentLabel(worker, worker.records[0])).toBe("codex · T007");
    const dispatcher = parse(codexRollout("/work/proj"));
    expect(dispatcher).toMatchObject({ spawned: false, task: "T006" });
    expect(laneOf(dispatcher, dispatcher.records[0])).toBe("orchestrator");
    const claude = parse(claudeTranscript("/work/proj"));
    expect(claude.records.map((record) => laneOf(claude, record))).toEqual(["orchestrator", "subagents"]);
  });

  it("prices tokens per million and leaves unpriced models without a cost", () => {
    const prices = new Map([["gpt-6-astra", { input: 1, cached: 0.1, output: 10 }]]);
    expect(costFor(prices, "gpt-6-astra", 1_000_000, 1_000_000, 100_000)).toBeCloseTo(2.1);
    expect(costFor(prices, "unknown-model", 1, 1, 1)).toBeNull();
    expect(costFor(new Map(), "gpt-6-astra", 1, 1, 1)).toBeNull();
  });

  it("rounds halves to even, as Python's round() does", () => {
    // Python 3: [round(6.25,1), round(6.35,1), round(0.125,2), round(2.5), round(3.5), round(7.06,1), round(1.15,1), round(2.675,2), round(-6.25,1), round(0.45,1), round(12.5,1), round(12345.05,1)]
    expect([roundHalfEven(6.25, 1), roundHalfEven(6.35, 1), roundHalfEven(0.125, 2), roundHalfEven(2.5, 0), roundHalfEven(3.5, 0), roundHalfEven(7.06, 1), roundHalfEven(1.15, 1), roundHalfEven(2.675, 2), roundHalfEven(-6.25, 1), roundHalfEven(0.45, 1), roundHalfEven(12.5, 1), roundHalfEven(12345.05, 1)])
      .toEqual([6.2, 6.3, 0.12, 2, 4, 7.1, 1.1, 2.67, -6.2, 0.5, 12.5, 12345]);
  });

  it("keeps no prompt or response text, and still reads usage nested beside a repeated type key", () => {
    const state = parse([
      { type: "user", cwd: "/work/proj", uuid: "u1", message: { content: "$gsd-path-build T001 secret: hunter2" } },
      { type: "user", cwd: "/work/proj", uuid: "u2", message: { content: [{ type: "tool_result", content: "{\"type\":\"user\"} long output" }] } },
      // A tool input object can repeat a "type" key before the record's own.
      { message: { id: "m1", model: "claude-sonnet-5-5", content: [{ type: "tool_use", input: { type: "user" } }], usage: { input_tokens: 1, output_tokens: 1 } }, type: "assistant", uuid: "a1", parentUuid: "u2" },
    ].map((line) => JSON.stringify(line)).join("\n"));
    expect(state.records).toHaveLength(1);
    expect(JSON.stringify(state)).not.toContain("hunter2");
  });
});

describe("host session parsing for a GSD Core workspace", () => {
  const core = (text: string, meta: { role: string | null; description: string | null } | null = null) => { const state = newSessionState("gsd-core", meta); for (const line of text.split("\n")) consumeLine(state, line); return state; };
  const executor = { role: "gsd-executor", description: "Execute plan 3 of phase 61" };

  it("labels the orchestrator by its slash command and keeps it in the orchestrator lane", () => {
    const state = core(coreOrchestrator("/work/proj"));
    expect(state.skill).toBe("/gsd-execute-phase");
    expect(state.records.map((record) => [laneOf(state, record), agentLabel(state, record)])).toEqual([["orchestrator", "/gsd-execute-phase"]]);
  });

  it("places an executor on the plan its prompt names first, as the overview writes plan ids", () => {
    const state = core(coreSubagent("/work/proj", "Execute .planning/phases/61-evidence/61-03-PLAN.md; it follows 61-02-PLAN.md."), executor);
    expect(state).toMatchObject({ role: "gsd-executor", plan: "61-3", phase: "61" });
    expect(state.records.map((record) => laneOf(state, record))).toEqual(["61-3", "61-3"]);
    expect(agentLabel(state, state.records[0])).toBe("gsd-executor · 61-3 · subagent");
    // Dotted phases with leading zeros read as the overview writes them.
    expect(core(coreSubagent("/w", "Read 05.01-012-PLAN.md first."), executor).plan).toBe("5.1-12");
  });

  it("places other GSD agents on their phase, from the task Claude Code recorded or their prompt, never from tool output", () => {
    const planner = core(coreSubagent("/w", "Plan the phase."), { role: "gsd-planner", description: "Plan Phase 61.2" });
    expect(planner.records.map((record) => laneOf(planner, record))).toEqual(["61.2", "61.2"]);
    const checker = core(coreSubagent("/w", "Check the plans of Phase 61."), { role: "gsd-plan-checker", description: "Check plans" });
    expect(laneOf(checker, checker.records[0])).toBe("61");
    // The prompt names no phase; the "Phase 12" in later tool output does not count.
    const lost = core(coreSubagent("/w", "Review the code."), { role: "gsd-code-reviewer", description: "Review" });
    expect(lost.phase).toBeNull();
    expect(laneOf(lost, lost.records[0])).toBe("subagents");
  });

  it("keeps subagents that are not GSD agents, or whose role is unknown, apart from any phase", () => {
    const explore = core(coreSubagent("/w", "Look around Phase 61."), { role: "Explore", description: "Explore phase 61" });
    expect(laneOf(explore, explore.records[0])).toBe("subagents");
    const unknown = core(coreSubagent("/w", "Execute 61-03-PLAN.md"));
    expect(laneOf(unknown, unknown.records[0])).toBe("subagents");
    // An executor whose prompt names no plan still belongs to its phase.
    const unplanned = core(coreSubagent("/w", "Finish the work."), executor);
    expect(laneOf(unplanned, unplanned.records[0])).toBe("61");
  });

  it("takes a Codex worker's role from its spawn record and its plan from its first read of a plan file", () => {
    const state = core(coreCodexWorker("/work/proj"));
    expect(state).toMatchObject({ spawned: true, role: "gsd-executor", plan: "61-3", phase: "61" });
    expect(state.records.map((record) => [laneOf(state, record), agentLabel(state, record)])).toEqual([["61-3", "gsd-executor · 61-3"]]);
    // Only an executor's own reads are searched: another worker's tool calls never place it, and its prompt names no phase.
    const debugger_ = core(coreCodexWorker("/work/proj", "gsd-debugger"));
    expect(debugger_).toMatchObject({ role: "gsd-debugger", plan: null, phase: null });
    expect(laneOf(debugger_, debugger_.records[0])).toBe("subagents");
  });

  it("places a Codex executor by the plan file it opens, never by plans its tool output lists first", () => {
    const listing = JSON.stringify({ timestamp: "2026-10-15T10:00:03.500Z", type: "event_msg", payload: { type: "item_completed", item: { type: "CommandExecution", output: '{"plans": ["61-01-PLAN.md", "61-02-PLAN.md", "61-03-PLAN.md"]}' } } });
    const output = JSON.stringify({ timestamp: "2026-10-15T10:00:03.600Z", type: "response_item", payload: { type: "custom_tool_call_output", output: "61-01-PLAN.md 61-02-PLAN.md" } });
    const lines = coreCodexWorker("/work/proj", "gsd-executor", "61-03").split("\n");
    // The listings come before the executor's own read of its plan file.
    lines.splice(4, 0, listing, output);
    expect(core(lines.join("\n"))).toMatchObject({ plan: "61-3", phase: "61" });
  });

  it("leaves GSD Path logs read exactly as before", () => {
    const state = newSessionState();
    for (const line of codexWorker("/work/proj").split("\n")) consumeLine(state, line);
    expect(state).toMatchObject({ flavor: "gsd-path", task: "T007", role: null, plan: null, phase: null });
    expect(laneOf(state, state.records[0])).toBe("T007");
    // A GSD Path log keeps its flavor even when its text looks like GSD Core.
    const path = newSessionState("gsd-path", { role: "gsd-executor", description: "Execute plan 3 of phase 61" });
    for (const line of coreSubagent("/w", "Execute 61-03-PLAN.md").split("\n")) consumeLine(path, line);
    expect(path).toMatchObject({ role: null, plan: null, phase: null });
    expect(laneOf(path, path.records[0])).toBe("subagents");
  });
});
