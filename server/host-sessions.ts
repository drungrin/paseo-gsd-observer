/**
 * Usage records from host session logs, read the way the GSD Path daemon reads them (`gsd_daemon/sessions.py`):
 * - Claude Code transcripts: each assistant record carries `message.model` and `message.usage`. One response writes one record
 *   per content block under the same `message.id`, the last with the final usage; its `requestRef` names the `api-request`
 *   record whose timestamp gives the timing.
 * - Codex rollouts: `session_meta`/`turn_context` give cwd and model, `token_usage_record` one record per model response, and
 *   `task_started` the turn's start.
 * Only numbers, model names, timestamps, the first `$gsd-path-*` skill, the first task id and whether a Codex session was spawned
 * by another are kept; prompt and response text is never stored.
 *
 * A GSD Core workspace's logs are read with GSD Core's own marks instead: the first `/gsd-*` command or `$gsd-*` skill, the agent's
 * role (Codex's spawn record, Claude Code's subagent meta file), the plan an executor works on (the first `<phase>-<plan>-PLAN.md`
 * its log names) and the phase any other GSD agent works on. Those are searched for only near the start of a log.
 */

export type HostName = "claude" | "codex";
/** Which pipeline's marks a log is read for; a log keeps the flavor of the workspace that first read it. */
export type SessionFlavor = "gsd-path" | "gsd-core";
/** What Claude Code's `agent-*.meta.json` says about a subagent transcript. */
export type SubagentMeta = { role: string | null; description: string | null };
export type HostRecord = {
  at: string | null; id: string | null; turn: string | null; model: string | null; host: HostName;
  tokensIn: number; tokensCached: number; tokensOut: number; durationS: number | null; subagent: boolean;
};

/** Everything a session file has said so far, so an appended file is read from where the last read stopped. */
export type SessionState = {
  flavor: SessionFlavor;
  cwd: string | null; skill: string | null; task: string | null; model: string | null; host: HostName;
  /** GSD Core: the agent's role ("gsd-executor", "gsd-planner"); null for a session nobody spawned or an unknown subagent. */
  role: string | null;
  /** GSD Core: an executor's plan ("61-3") and the phase any GSD agent works on ("61"), as the overview writes their ids. */
  plan: string | null; phase: string | null;
  /** GSD Core: user records seen, and lines a Codex executor's plan was searched in; both searches stop early. */
  prompts: number; searched: number;
  /** A Codex thread spawned by another (`session_meta.source.subagent`): a worker, not the session that dispatched it. */
  spawned: boolean;
  turnStarted: Map<string, number>; lastAt: Map<string, number>; requestAt: Map<string, number>; responses: Map<string, HostRecord>;
  records: HostRecord[];
};

const SKILL = /\$gsd-path-[a-z][a-z-]*/;
const TASK = /\bT\d{3,}\b/;
// GSD Core: a Claude Code slash command as the transcript records it, or a Codex skill.
const CORE_SKILL = /<command-name>\/?(gsd[:-][a-z][a-z-]{0,40})<\/command-name>|\$(gsd-[a-z][a-z-]{0,40})/;
const PLAN_FILE = /\b(\d{1,6}(?:\.\d{1,6}){0,7})-(\d{1,4})-PLAN\.md\b/;
const PHASE = /\b[Pp]hase\s+(\d{1,6}(?:\.\d{1,6}){0,7})\b/;
const ROLE = /^[a-z][a-z0-9-]{0,40}$/;
// A Codex tool call, never its output: an executor's first command can print every plan of its phase before it reads its own.
const TOOL_CALL = /"type"\s*:\s*"(?:custom_tool_call|function_call|local_shell_call)"/;
/**
 * GSD Core marks are taken only from a log's start. A plan or phase comes from the prompt (the first PROMPT_RECORDS user records):
 * later user records are tool output, which may name any phase. The orchestrator's command and a Codex executor's first reads
 * of its plan file are searched through CORE_SEARCH records.
 */
const PROMPT_RECORDS = 3;
const CORE_SEARCH = 400;
// Only these records carry usage, timing, cwd or the agent's skill and task; every other line is skipped without parsing.
const RELEVANT = /"type"\s*:\s*"(?:assistant|user|api-request|session_meta|turn_context|event_msg|response_item|token_usage_record)"/;
// Lines that may carry usage or timing. A nested object can repeat any "type" key, so this only decides what may be skipped.
const TIMED = /"type"\s*:\s*"(?:assistant|api-request|session_meta|turn_context|token_usage_record)"|task_started/;

export const newSessionState = (flavor: SessionFlavor = "gsd-path", meta: SubagentMeta | null = null): SessionState => {
  const state: SessionState = {
    flavor, cwd: null, skill: null, task: null, model: null, host: "codex", spawned: false, role: null, plan: null, phase: null, prompts: 0, searched: 0,
    turnStarted: new Map(), lastAt: new Map(), requestAt: new Map(), responses: new Map(), records: [],
  };
  if (flavor === "gsd-core" && meta) {
    state.role = meta.role && ROLE.test(meta.role) ? meta.role : null;
    // "Execute plan 3 of phase 61", "Fill validation gap for Phase 57": the task the orchestrator gave the subagent.
    state.phase = phaseOf(PHASE.exec(meta.description ?? "")?.[1]);
  }
  return state;
};

/** A phase id as the overview writes it: each part without leading zeros ("05.1" reads "5.1"). */
const phaseOf = (value: string | undefined) => value ? value.split(".").map((part) => part.replace(/^0+(?=\d)/, "")).join(".") : null;
/** "61-03-PLAN.md" names plan "61-3" of phase "61". */
function notePlan(state: SessionState, words: string) {
  const match = PLAN_FILE.exec(words);
  if (!match) return;
  state.plan = `${phaseOf(match[1])}-${Number(match[2])}`;
  state.phase ??= phaseOf(match[1]);
}


const epoch = (value: unknown): number | null => {
  if (typeof value !== "string" || !value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time / 1000;
};
// Python's int(): integers and floats count, truncated; booleans and anything else are zero. A negative or absurd count is clamped,
// so one malformed record can never make a total negative or unsafe.
// Far above any real count, and low enough that sums over a lifetime of turns stay safe integers.
const MAX_COUNT = 2 ** 40;
const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? Math.min(MAX_COUNT, Math.max(0, Math.trunc(value))) : 0;
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
  if (state.flavor === "gsd-core") {
    if (state.prompts >= CORE_SEARCH) return;
    state.prompts += 1;
    const words = text(content);
    if (!state.skill) { const match = CORE_SKILL.exec(words); if (match) state.skill = match[1] ? `/${match[1].replace(":", "-")}` : `$${match[2]}`; }
    if (state.prompts > PROMPT_RECORDS) return;
    // An executor's own plan file comes first in its prompt; any other agent is placed by the phase it names.
    if (state.role === "gsd-executor" && !state.plan) notePlan(state, words);
    if (!state.phase) state.phase = phaseOf(PHASE.exec(words)?.[1]) ?? phaseOf(PLAN_FILE.exec(words)?.[1]);
    return;
  }
  if (state.skill && state.task) return;
  const words = text(content);
  state.skill ??= SKILL.exec(words)?.[0] ?? null;
  state.task ??= TASK.exec(words)?.[0] ?? null;
}

/**
 * Whether a user line can still add anything: once cwd, skill and task are known, user text is never parsed again. A GSD Core
 * log is searched only through its first CORE_SEARCH records.
 */
const needsUserText = (state: SessionState) => state.flavor === "gsd-core"
  ? !state.cwd || state.prompts < PROMPT_RECORDS || (!state.skill && !state.role && !state.spawned && state.prompts < CORE_SEARCH)
  : !state.cwd || !state.skill || !state.task;

export function consumeLine(state: SessionState, line: string): void {
  if (!RELEVANT.test(line)) return;
  // A spawned Codex executor reads its plan file in its first tool calls; the raw call is searched, never parsed for it.
  if (state.flavor === "gsd-core" && state.spawned && state.role === "gsd-executor" && !state.plan && state.searched < CORE_SEARCH) {
    state.searched += 1;
    if (TOOL_CALL.test(line)) notePlan(state, line);
  }
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
  if (kind === "session_meta") {
    state.cwd ??= string(payload.cwd);
    const subagent = record(payload.source)?.subagent;
    state.spawned ||= Boolean(subagent);
    // Codex records the role a GSD Core orchestrator spawned the worker as.
    const role = string(record(record(subagent)?.thread_spawn)?.agent_role);
    if (state.flavor === "gsd-core" && role && ROLE.test(role)) state.role ??= role;
  }
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

/**
 * The activity lane a turn belongs to: a subagent (a Claude sidechain or a spawned Codex worker) works on the first task its
 * log names, else it is another subagent; a session nobody spawned is the orchestrator, whatever task it mentions first.
 * In GSD Core an executor works on its plan, any other GSD agent on its phase, and the rest are other subagents.
 */
export function laneOf(state: SessionState, entry: HostRecord): string {
  const subagent = entry.subagent || state.spawned;
  if (state.flavor !== "gsd-core") return subagent ? state.task ?? "subagents" : "orchestrator";
  if (!subagent) return "orchestrator";
  if (state.role === "gsd-executor") return state.plan ?? state.phase ?? "subagents";
  return state.role?.startsWith("gsd-") && state.phase ? state.phase : "subagents";
}

/**
 * "claude · T004 · subagent": the file's first skill (else its host), first task id, and whether a subagent wrote the turn.
 * In GSD Core: "/gsd-execute-phase" for the orchestrator, "gsd-executor · 61-3" for a subagent.
 */
export function agentLabel(state: SessionState, entry: HostRecord): string {
  if (state.flavor !== "gsd-core") return `${state.skill ?? state.host}${state.task ? ` · ${state.task}` : ""}${entry.subagent ? " · subagent" : ""}`;
  const lane = laneOf(state, entry);
  const who = lane === "orchestrator" ? state.skill ?? state.host : state.role ?? state.host;
  return `${who}${lane !== "orchestrator" && lane !== "subagents" ? ` · ${lane}` : ""}${entry.subagent ? " · subagent" : ""}`;
}

export type Price = { input: number; cached: number; output: number };

/** USD for one record from a per-million-token price table; null when the model has no price. */
export function costFor(prices: ReadonlyMap<string, Price>, model: string | null, tokensIn: number, cached: number, tokensOut: number): number | null {
  const price = prices.get(model ?? "");
  return price ? (tokensIn * price.input + cached * price.cached + tokensOut * price.output) / 1e6 : null;
}
