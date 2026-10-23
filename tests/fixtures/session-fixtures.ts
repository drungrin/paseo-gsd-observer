/** The GSD Path daemon's own fixtures (`tests/test_daemon_sessions.py`), with the values it expects. */
export const codexRollout = (cwd: string, model = "gpt-6-astra", prompt = "$gsd-path-build T006 please") => [
  { timestamp: "2026-09-10T10:00:00.000Z", type: "session_meta", payload: { cwd, originator: "codex_exec" } },
  { timestamp: "2026-09-10T10:00:01.000Z", type: "event_msg", payload: { type: "task_started", turn_id: "turn-1", started_at: Date.UTC(2026, 8, 10, 10, 0, 1) / 1000 } },
  { timestamp: "2026-09-10T10:00:02.000Z", type: "turn_context", payload: { turn_id: "turn-1", cwd, model } },
  { timestamp: "2026-09-10T10:00:03.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: prompt }] } },
  { timestamp: "2026-09-10T10:00:31.000Z", type: "token_usage_record", payload: { turn_id: "turn-1", usage: { input_tokens: 1000, cached_input_tokens: 400, output_tokens: 50 } } },
  { timestamp: "2026-09-10T10:01:01.000Z", type: "token_usage_record", payload: { turn_id: "turn-1", usage: { input_tokens: 2000, cached_input_tokens: 1500, output_tokens: 100 } } },
].map((line) => JSON.stringify(line)).concat("not json").join("\n") + "\n";

export const claudeTranscript = (cwd: string, model = "claude-sonnet-5") => [
  { type: "user", cwd, timestamp: "2026-09-01T09:00:00.000Z", uuid: "u1", message: { role: "user", content: "$gsd-path-plan the thing" } },
  { type: "assistant", cwd, timestamp: "2026-09-01T09:00:05.000Z", uuid: "a1", parentUuid: "u1", isSidechain: false, message: { model, usage: { input_tokens: 10, cache_creation_input_tokens: 90, cache_read_input_tokens: 300, output_tokens: 20 } } },
  { type: "assistant", cwd, timestamp: "2026-09-01T09:00:09.000Z", uuid: "a2", parentUuid: "u1", isSidechain: true, message: { model, usage: { input_tokens: 5, cache_read_input_tokens: 0, output_tokens: 7 } } },
].map((line) => JSON.stringify(line)).join("\n") + "\n";

/** A Codex worker the orchestrator spawned for one task: `session_meta.source` names its parent thread. */
export const codexWorker = (cwd: string, task = "T007") => codexRollout(cwd, "gpt-6-astra", `Implement ${task} as briefed`)
  .replace('"originator":"codex_exec"', '"originator":"codex_exec","source":{"subagent":{"thread_spawn":{"parent_thread_id":"thread-0","depth":1,"agent_role":"worker"}}}');

/** A GSD Core orchestrator in Claude Code: the slash command the transcript records, then the dispatch it does itself. */
export const coreOrchestrator = (cwd: string) => [
  { type: "user", cwd, timestamp: "2026-10-15T09:00:00.000Z", uuid: "u1", message: { role: "user", content: "<command-message>gsd-execute-phase</command-message>\n<command-name>/gsd-execute-phase</command-name>\n<command-args>61</command-args>" } },
  { type: "assistant", cwd, timestamp: "2026-10-15T09:00:05.000Z", uuid: "a1", parentUuid: "u1", isSidechain: false, message: { id: "o1", model: "claude-opus-5-5", usage: { input_tokens: 10, output_tokens: 5 } } },
].map((line) => JSON.stringify(line)).join("\n") + "\n";

/** A GSD Core subagent transcript, as Claude Code writes it under `<session>/subagents/`: its prompt, then its turns. */
export const coreSubagent = (cwd: string, prompt: string, id = "s1") => [
  { type: "user", cwd, isSidechain: true, timestamp: "2026-10-15T09:10:00.000Z", uuid: `${id}-u1`, message: { role: "user", content: prompt } },
  { type: "assistant", cwd, isSidechain: true, timestamp: "2026-10-15T09:10:30.000Z", uuid: `${id}-a1`, parentUuid: `${id}-u1`, message: { id: `${id}-m1`, model: "claude-sonnet-5-5", usage: { input_tokens: 100, output_tokens: 20 } } },
  // Tool output may name any phase or plan; it never places the agent.
  { type: "user", cwd, isSidechain: true, timestamp: "2026-10-15T09:11:00.000Z", uuid: `${id}-u2`, message: { role: "user", content: [{ type: "tool_result", content: "Phase 12 and 12-04-PLAN.md are unrelated" }] } },
  { type: "assistant", cwd, isSidechain: true, timestamp: "2026-10-15T09:11:30.000Z", uuid: `${id}-a2`, parentUuid: `${id}-u2`, message: { id: `${id}-m2`, model: "claude-sonnet-5-5", usage: { input_tokens: 50, output_tokens: 10 } } },
].map((line) => JSON.stringify(line)).join("\n") + "\n";

/** A Codex executor a GSD Core orchestrator spawned: its spawn record names its role, and it reads its own plan first. */
export const coreCodexWorker = (cwd: string, role = "gsd-executor", plan = "61-03") => [
  { timestamp: "2026-10-15T10:00:00.000Z", type: "session_meta", payload: { cwd, originator: "codex_exec", source: { subagent: { thread_spawn: { parent_thread_id: "thread-0", depth: 1, agent_role: role, agent_path: "/root/execute_61_03" } } } } },
  { timestamp: "2026-10-15T10:00:01.000Z", type: "event_msg", payload: { type: "task_started", turn_id: "turn-1", started_at: Date.UTC(2026, 9, 15, 10, 0, 1) / 1000 } },
  { timestamp: "2026-10-15T10:00:02.000Z", type: "turn_context", payload: { turn_id: "turn-1", cwd, model: "gpt-6-astra" } },
  { timestamp: "2026-10-15T10:00:03.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Execute the plan you were assigned." }] } },
  { timestamp: "2026-10-15T10:00:04.000Z", type: "response_item", payload: { type: "custom_tool_call", name: "shell", input: `cat .planning/phases/61-evidence/${plan}-PLAN.md` } },
  { timestamp: "2026-10-15T10:00:31.000Z", type: "token_usage_record", payload: { turn_id: "turn-1", usage: { input_tokens: 1000, cached_input_tokens: 400, output_tokens: 50 } } },
].map((line) => JSON.stringify(line)).join("\n") + "\n";
