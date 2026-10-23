import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { MilestoneIdSchema } from "./path.js";

/**
 * Host usage for a workspace, from Claude Code and Codex session logs whose working directory lies inside it. Only numbers,
 * model names, timestamps and agent labels cross the wire; no prompt, response, path or command does.
 */

const WorkspaceIdSchema = z.string().min(1).max(128);
const CountSchema = z.number().int().nonnegative();
const CostSchema = z.number().nonnegative().finite();
const SecondsSchema = z.number().nonnegative().finite();
export const HostSchema = z.enum(["claude", "codex"]);
/** A model name as the host recorded it ("claude-sonnet-5-5", "example-model-1.0"); anything else reads "unknown". */
export const ModelNameSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/);
/** "claude", "$gsd-path-build", optionally with a task id and a subagent mark. */
export const AgentLabelSchema = z.string().regex(/^(?:claude|codex|\$gsd-path-[a-z][a-z-]{0,40})(?: · T\d{3,6})?(?: · subagent)?$/);
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
export type LedgerRecord = z.infer<typeof LedgerRecordSchema>;
export type LedgerPage = z.infer<typeof LedgerPageSchema>;
