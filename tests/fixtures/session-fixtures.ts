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
