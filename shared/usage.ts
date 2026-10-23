import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { MilestoneIdSchema, TaskIdSchema } from "./path.js";
import { PhaseIdSchema } from "./safe-text.js";

/**
 * Host usage for a workspace, from Claude Code and Codex session logs whose working directory lies inside it. Only numbers,
 * model names, timestamps, task ids and agent labels cross the wire; no prompt, response, path or command does.
 */

const WorkspaceIdSchema = z.string().min(1).max(128);
const CountSchema = z.number().int().nonnegative();
const CostSchema = z.number().nonnegative().finite();
const SecondsSchema = z.number().nonnegative().finite();
export const HostSchema = z.enum(["claude", "codex"]);
/** A model name as the host recorded it ("claude-sonnet-5-5", "example-model-1.0"); anything else reads "unknown". */
export const ModelNameSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/);
/** A GSD Core plan as the overview writes its id: "61-3", "59.3-17". */
export const PlanLaneSchema = z.string().max(129).regex(/^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))*-(?:0|[1-9]\d*)$/);
/**
 * "claude", "$gsd-path-build", optionally with a task id and a subagent mark. GSD Core: the orchestrator's command or skill
 * ("/gsd-execute-phase", "$gsd-verify-work") or a subagent's role ("gsd-executor"), optionally with its plan or phase.
 */
export const AgentLabelSchema = z.string().regex(/^(?:claude|codex|\$gsd-path-[a-z][a-z-]{0,40}|[/$]gsd-[a-z][a-z-]{0,40}|[a-z][a-z0-9-]{0,40})(?: · (?:T\d{3,6}|\d{1,6}(?:\.\d{1,6}){0,7}(?:-\d{1,4})?))?(?: · subagent)?$/);
/**
 * A task id for its subagents, "orchestrator" for sessions nobody spawned, "subagents" for subagents whose log names no task.
 * GSD Core: a plan for its executors, a phase for the other GSD agents working on it.
 */
export const ActivityLaneSchema = z.union([TaskIdSchema, PlanLaneSchema, PhaseIdSchema, z.literal("orchestrator"), z.literal("subagents")]);
/** Activity is counted in ten-minute buckets, newest kept first when there are more than the limit. */
export const ACTIVITY_BUCKET_MS = 600_000;
export const ACTIVITY_LIMIT = 8_000;
const TimestampSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})?$/);

export const UsageTotalsSchema = z.object({
  turns: CountSchema, prompts: CountSchema, tokensIn: CountSchema, tokensCached: CountSchema, tokensOut: CountSchema,
  /** Null when no turn had a price. */
  cost: CostSchema.nullable(), pricedTurns: CountSchema, durationS: SecondsSchema, timedTurns: CountSchema,
}).strict();

export const UsageSlotSchema = z.object({ turns: CountSchema, tokens: CountSchema, cost: CostSchema.nullable() }).strict();

export const BoardUsageSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  observedAt: z.string().datetime(),
  /** "none": no session file recorded a working directory inside the workspace. */
  availability: z.enum(["available", "none", "unavailable"]),
  /** False while session files are still being read; the figures can only grow. */
  complete: z.boolean(),
  /** A session root held more entries than the walk reads; asking again does not read further. */
  limited: z.boolean(),
  /** Whether the GSD Path daemon's price table could be read. */
  pricing: z.enum(["configured", "missing"]),
  sessions: CountSchema,
  totals: UsageTotalsSchema,
  models: z.array(UsageSlotSchema.extend({ model: ModelNameSchema.nullable(), host: HostSchema }).strict()).max(64),
  /** Usage per roadmap milestone; `id` null is the current milestone when the roadmap does not list it. */
  milestones: z.array(UsageSlotSchema.extend({ id: MilestoneIdSchema.nullable() }).strict()).max(129),
  unpriced: z.array(ModelNameSchema).max(32),
  /** Usage of each task's subagents, with the first and last turn time, by task id. */
  tasks: z.array(UsageSlotSchema.extend({ id: TaskIdSchema, durationS: SecondsSchema, first: TimestampSchema.nullable(), last: TimestampSchema.nullable() }).strict()).max(512),
  /** GSD Core: usage of each plan's executors, with the first and last turn time, by plan id. */
  plans: z.array(UsageSlotSchema.extend({ id: PlanLaneSchema, durationS: SecondsSchema, first: TimestampSchema.nullable(), last: TimestampSchema.nullable() }).strict()).max(512),
  /** GSD Core: usage of each phase's agents, its plans' executors included. */
  phases: z.array(UsageSlotSchema.extend({ id: PhaseIdSchema, durationS: SecondsSchema }).strict()).max(256),
  /** Turns and cost per lane in each ten-minute bucket that had any, oldest first. */
  activity: z.array(z.object({ lane: ActivityLaneSchema, at: TimestampSchema, turns: CountSchema, cost: CostSchema.nullable() }).strict()).max(ACTIVITY_LIMIT),
  /** More buckets had activity than the limit; the oldest are left out. */
  activityLimited: z.boolean(),
}).strict();

export const LedgerRecordSchema = z.object({
  at: TimestampSchema.nullable(), agent: AgentLabelSchema, host: HostSchema, model: ModelNameSchema.nullable(),
  tokensIn: CountSchema, tokensCached: CountSchema, tokensOut: CountSchema, durationS: SecondsSchema.nullable(), cost: CostSchema.nullable(),
}).strict();

export const LEDGER_PAGE = 200;
export const LedgerPageSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  availability: z.enum(["available", "none", "unavailable"]),
  complete: z.boolean(),
  total: CountSchema,
  offset: CountSchema,
  /** Newest first. */
  records: z.array(LedgerRecordSchema).max(500),
}).strict();

export const usageRpc = defineRpc({ name: "gsd-observer.usage", input: z.object({ workspaceId: WorkspaceIdSchema }).strict(), output: BoardUsageSchema });
export const ledgerRpc = defineRpc({
  name: "gsd-observer.ledger",
  input: z.object({ workspaceId: WorkspaceIdSchema, offset: CountSchema.max(10_000_000), limit: z.number().int().min(1).max(500), anchor: CountSchema.max(10_000_000).optional() }).strict(),
  output: LedgerPageSchema,
});

export type BoardUsage = z.infer<typeof BoardUsageSchema>;
export type UsageTotals = z.infer<typeof UsageTotalsSchema>;
export type UsageSlot = z.infer<typeof UsageSlotSchema>;
export type UsageTask = BoardUsage["tasks"][number];
export type UsagePlan = BoardUsage["plans"][number];
export type UsagePhase = BoardUsage["phases"][number];
export type UsageActivity = BoardUsage["activity"][number];
export type ActivityLane = UsageActivity["lane"];
export type LedgerRecord = z.infer<typeof LedgerRecordSchema>;
export type LedgerPage = z.infer<typeof LedgerPageSchema>;
