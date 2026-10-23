/**
 * Usage records from host session logs, read the way the GSD Path daemon reads them (`gsd_daemon/sessions.py`):
 * - Claude Code transcripts: each assistant record carries `message.model` and `message.usage`. One response writes one record
 *   per content block under the same `message.id`, the last with the final usage; its `requestRef` names the `api-request`
 *   record whose timestamp gives the timing.
 * - Codex rollouts: `session_meta`/`turn_context` give cwd and model, `token_usage_record` one record per model response, and
 *   `task_started` the turn's start.
 * Only numbers, model names, timestamps, the first `$gsd-path-*` skill and the first task id are kept; prompt and response text
 * is never stored.
 */

export type HostName = "claude" | "codex";
export type HostRecord = {
  at: string | null; id: string | null; turn: string | null; model: string | null; host: HostName;
  tokensIn: number; tokensCached: number; tokensOut: number; durationS: number | null; subagent: boolean;
};

/** Everything a session file has said so far, so an appended file is read from where the last read stopped. */
export type SessionState = {
  cwd: string | null; skill: string | null; task: string | null; model: string | null; host: HostName;
  turnStarted: Map<string, number>; lastAt: Map<string, number>; requestAt: Map<string, number>; responses: Map<string, HostRecord>;
  records: HostRecord[];
};

const SKILL = /\$gsd-path-[a-z][a-z-]*/;
const TASK = /\bT\d{3,}\b/;
// Only these records carry usage, timing, cwd or the agent's skill and task; every other line is skipped without parsing.
const RELEVANT = /"type"\s*:\s*"(?:assistant|user|api-request|session_meta|turn_context|event_msg|response_item|token_usage_record)"/;
// Lines that may carry usage or timing. A nested object can repeat any "type" key, so this only decides what may be skipped.
const TIMED = /"type"\s*:\s*"(?:assistant|api-request|session_meta|turn_context|token_usage_record)"|task_started/;

export const newSessionState = (): SessionState => ({
  cwd: null, skill: null, task: null, model: null, host: "codex",
  turnStarted: new Map(), lastAt: new Map(), requestAt: new Map(), responses: new Map(), records: [],
});

const epoch = (value: unknown): number | null => {
  if (typeof value !== "string" || !value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time / 1000;
};
// Python's int(): integers and floats count, truncated; booleans and anything else are zero.
const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
/**
 * Python's round(value, digits), so sums over thousands of turns match the daemon's. Both round the stored binary value, not
 * its decimal spelling (6.35 is stored just below and becomes 6.3); only an exact tie goes to the even neighbour, where
 * toFixed would round it away from zero.
 */
export function roundHalfEven(value: number, digits: number): number {
  if (!Number.isFinite(value) || Math.abs(value) >= 1e21) return value;
  const rounded = Number(value.toFixed(digits));
  // toFixed spells the stored value exactly, so the digits past the kept ones show an exact tie.
  const [whole, fraction = ""] = value.toFixed(Math.min(100, digits + 60)).split(".");
  if (!/^50*$/.test(fraction.slice(digits))) return rounded;
  const kept = digits ? fraction.slice(0, digits) : whole;
  return Number(kept.at(-1)) % 2 === 0 ? Number(digits ? `${whole}.${kept}` : whole) : rounded;
}
const round1 = (value: number) => roundHalfEven(value, 1);
const text = (content: unknown): string => typeof content === "string" ? content
  : Array.isArray(content) ? content.map((part) => part && typeof part === "object" ? String((part as { text?: unknown }).text ?? "") : "").join(" ") : "";
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const string = (value: unknown) => typeof value === "string" ? value : null;

function noteAgent(state: SessionState, content: unknown) {
  if (state.skill && state.task) return;
  const words = text(content);
  state.skill ??= SKILL.exec(words)?.[0] ?? null;
  state.task ??= TASK.exec(words)?.[0] ?? null;
}

/** Whether a user line can still add anything: once cwd, skill and task are known, user text is never parsed again. */
const needsUserText = (state: SessionState) => !state.cwd || !state.skill || !state.task;

export function consumeLine(state: SessionState, line: string): void {
  if (!RELEVANT.test(line)) return;
  // User text, often whole tool outputs, is parsed only until it has given the cwd, skill and task.
  if (!needsUserText(state) && !TIMED.test(line)) return;
  let parsed: unknown;
  try { parsed = JSON.parse(line); } catch { return; }
  const entry = record(parsed);
  if (!entry) return;
  const kind = entry.type;
  const payload = record(entry.payload);
  if (kind === "api-request") {
    const sent = epoch(entry.timestamp);
    const id = string(entry.id);
    if (id && sent !== null) state.requestAt.set(id, sent);
    return;
  }
  const message = record(entry.message);
  if ((kind === "user" || kind === "assistant") && message) {
    state.host = "claude";
    state.cwd ??= string(entry.cwd);
    if (kind === "user") { noteAgent(state, message.content); return; }
    const usage = record(message.usage);
    if (!usage || !Object.keys(usage).length) return;
    const at = string(entry.timestamp);
    const now = epoch(at);
    const sent = state.requestAt.get(string(entry.requestRef) ?? "") ?? null;
    const next: HostRecord = {
      at, id: string(message.id), turn: string(entry.parentUuid) ?? string(entry.uuid), model: string(message.model), host: "claude",
      tokensIn: count(usage.input_tokens) + count(usage.cache_creation_input_tokens), tokensCached: count(usage.cache_read_input_tokens),
      tokensOut: count(usage.output_tokens), durationS: now !== null && sent !== null && now >= sent ? round1(now - sent) : null,
      subagent: entry.isSidechain === true,
    };
    // A later block of the same response replaces the earlier usage and end time, keeping the turn it started in.
    const first = next.id ? state.responses.get(next.id) : undefined;
    if (first) { Object.assign(first, next, { turn: first.turn }); return; }
    if (next.id) state.responses.set(next.id, next);
    state.records.push(next);
    return;
  }
  if (!payload) return;
  if (kind === "session_meta") state.cwd ??= string(payload.cwd);
  else if (kind === "turn_context") { state.cwd ??= string(payload.cwd); state.model = string(payload.model) ?? state.model; }
  else if (kind === "event_msg" && payload.type === "task_started") {
    const turn = string(payload.turn_id);
    if (turn && typeof payload.started_at === "number") state.turnStarted.set(turn, payload.started_at);
  } else if (kind === "response_item" && payload.role === "user") noteAgent(state, payload.content);
  else if (kind === "token_usage_record") {
    const usage = record(payload.usage) ?? record(payload.turn_token_usage) ?? {};
    const turn = string(payload.turn_id);
    const at = string(entry.timestamp);
    const now = epoch(at);
    const previous = (turn ? state.lastAt.get(turn) ?? state.turnStarted.get(turn) : undefined) ?? null;
    if (now !== null && turn) state.lastAt.set(turn, now);
    state.records.push({
      at, id: null, turn, model: state.model, host: state.host,
      // Cached input is counted apart; a malformed record never makes input negative.
      tokensIn: Math.max(0, count(usage.input_tokens) - count(usage.cached_input_tokens)), tokensCached: count(usage.cached_input_tokens),
      tokensOut: count(usage.output_tokens), durationS: now !== null && previous !== null && now >= previous ? round1(now - previous) : null,
      subagent: false,
    });
  }
}

/** "claude · T004 · subagent": the file's first skill (else its host), first task id, and whether a subagent wrote the turn. */
export const agentLabel = (state: SessionState, entry: HostRecord) => `${state.skill ?? state.host}${state.task ? ` · ${state.task}` : ""}${entry.subagent ? " · subagent" : ""}`;

export type Price = { input: number; cached: number; output: number };

/** USD for one record from a per-million-token price table; null when the model has no price. */
export function costFor(prices: ReadonlyMap<string, Price>, model: string | null, tokensIn: number, cached: number, tokensOut: number): number | null {
  const price = prices.get(model ?? "");
  return price ? (tokensIn * price.input + cached * price.cached + tokensOut * price.output) / 1e6 : null;
}
