import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const WarningSchema = z.enum([
  "absent", "oversize", "malformed", "truncated", "unsupported",
  "containment-refused", "unreadable", "limit-reached", "observation-limited", "inconsistent",
  "reconciliation-unavailable",
]);

const AvailabilitySchema = z.enum(["available", "unavailable", "unsupported", "unknown"]);
const FreshnessSchema = z.enum(["current", "stale", "refresh-failed"]);
const PlanDetailsSchema = z.object({
  type: z.string().max(64).optional(), wave: z.number().int().nonnegative().optional(), dependsOn: z.array(z.string().max(128)).max(32), requirements: z.array(z.string().max(128)).max(32),
  objective: z.object({ statement: z.string().max(640).optional(), purpose: z.string().max(640).optional(), output: z.string().max(640).optional() }).strict().optional(), truths: z.array(z.string().max(240)).max(8), guardrails: z.array(z.object({ statement: z.string().max(240), status: z.string().max(64).optional() }).strict()).max(8), taskCount: z.number().int().nonnegative(), checkpointCount: z.number().int().nonnegative(), blockingHumanCount: z.number().int().nonnegative(), successCriteria: z.array(z.string().max(240)).max(8), plannedOutputs: z.array(z.string().max(240)).max(8),
  summary: z.object({ exists: z.boolean(), status: z.string().max(64).optional(), outcome: z.string().max(640).optional(), requires: z.array(z.string().max(240)).max(8), provides: z.array(z.string().max(240)).max(8), affects: z.array(z.string().max(240)).max(8), actuals: z.object({ tokens: z.number().int().nonnegative().optional(), tasks: z.number().int().nonnegative().optional(), commits: z.number().int().nonnegative().optional() }).strict().optional(), duration: z.string().max(64).optional(), completed: z.string().max(64).optional(), decisions: z.array(z.string().max(240)).max(8), deviations: z.string().max(640).optional(), issues: z.string().max(640).optional(), nextReadiness: z.string().max(640).optional(), observedChangeCount: z.number().int().nonnegative() }).strict(),
}).strict();

export const BoardSnapshotSchema = z.object({
  workspaceId: z.string().min(1).max(128),
  observedAt: z.string().datetime().nullable(),
  freshness: FreshnessSchema,
  availability: AvailabilitySchema,
  revision: z.number().int().nonnegative(),
  milestones: z.array(z.object({
    id: z.string().min(1).max(64), title: z.string().min(1).max(200), archived: z.boolean(), active: z.boolean(),
    availability: AvailabilitySchema, phases: z.array(z.object({ id: z.string(), phaseId: z.string(), title: z.string(), column: z.enum(["backlog", "discussed", "planned", "executing", "verifying", "completed", "unknown", "unavailable"]), roadmapDeclared: z.boolean(), plans: z.array(z.object({ id: z.string(), planId: z.string(), title: z.string().min(1).max(160).optional(), goal: z.string().min(1).max(640).optional(), successCriteria: z.array(z.string().min(1).max(240)).max(8).optional(), summaryStatus: z.string().min(1).max(64).optional(), details: PlanDetailsSchema.optional(), evidenceStatus: z.enum(["planned", "summary-present", "unknown", "unavailable"]), summaryPaired: z.boolean(), availability: AvailabilitySchema, proof: z.array(z.object({ source: z.enum(["roadmap", "context", "plan", "summary", "state", "review", "uat", "verification", "reconciliation"]), status: z.enum(["observed", "pending", "passed", "invalid", "unknown", "unavailable"]), safeId: z.string().max(64).optional(), count: z.number().int().nonnegative().optional() }).strict()).max(16), warnings: z.array(WarningSchema).max(16) }).strict()).max(128), planCount: z.number().int().nonnegative().nullable(), summaryCount: z.number().int().nonnegative().nullable(), stateMarker: z.boolean(), review: z.enum(["absent", "open", "resolved", "unknown", "unavailable"]), uat: z.enum(["absent", "pending", "partial", "passed", "failed", "unknown", "unavailable"]), proof: z.array(z.object({ source: z.enum(["roadmap", "context", "plan", "summary", "state", "review", "uat", "verification", "reconciliation"]), status: z.enum(["observed", "pending", "passed", "invalid", "unknown", "unavailable"]), safeId: z.string().max(64).optional(), count: z.number().int().nonnegative().optional() }).strict()).max(16), warnings: z.array(WarningSchema).max(16), availability: AvailabilitySchema, limited: z.boolean(), goal: z.string().min(1).max(640).optional(), mode: z.string().min(1).max(64).optional(), dependsOn: z.string().min(1).max(240).optional(), requirements: z.array(z.string().min(1).max(64)).max(32).optional(), uiHint: z.string().min(1).max(64).optional(), successCriteria: z.array(z.string().min(1).max(240)).max(8).optional() }).strict()).max(256), warnings: z.array(WarningSchema).max(16), limited: z.boolean() }).strict()).max(32),
  warnings: z.array(WarningSchema).max(16),
  limited: z.boolean(),
}).strict();

export const BoardStatusSchema = z.object({
  kind: z.literal("status"), workspaceId: z.string().min(1).max(128), observedAt: z.string().datetime().nullable(), freshness: FreshnessSchema, availability: AvailabilitySchema, revision: z.number().int().nonnegative(), warnings: z.array(WarningSchema).max(16),
}).strict();

export const BoardResponseSchema = z.union([z.object({ kind: z.literal("snapshot"), snapshot: BoardSnapshotSchema }).strict(), BoardStatusSchema]);
const WorkspaceIdSchema = z.string().min(1).max(128);
const ArchiveMilestoneIdSchema = z.string().regex(/^archive:[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
export const BoardRequestSchema = z.discriminatedUnion("intent", [
  z.object({ workspaceId: WorkspaceIdSchema, intent: z.enum(["snapshot", "refresh", "status"]) }).strict(),
  z.object({ workspaceId: WorkspaceIdSchema, intent: z.literal("archive"), milestoneId: ArchiveMilestoneIdSchema }).strict(),
]);
export const boardRpc = defineRpc({ name: "gsd-observer.board", input: BoardRequestSchema, output: BoardResponseSchema });

export type BoardSnapshot = z.infer<typeof BoardSnapshotSchema>;
export type BoardStatus = z.infer<typeof BoardStatusSchema>;
export type BoardResponse = z.infer<typeof BoardResponseSchema>;
export type BoardRequest = z.infer<typeof BoardRequestSchema>;
