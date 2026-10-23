import { describe, expect, it } from "vitest";
import { agentLabel, consumeLine, costFor, laneOf, newSessionState, roundHalfEven } from "../../server/host-sessions";
import { claudeTranscript, codexRollout, codexWorker } from "../fixtures/session-fixtures";

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
