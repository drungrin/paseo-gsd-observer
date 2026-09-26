import { z } from "zod";
import { BoardContextSchema } from "./context.js";
import { BoardUatSchema } from "./uat.js";
import { BoardValidationSchema, PathFreeTextSchema } from "./validation.js";
import { BoardVerificationSchema } from "./verification.js";
import { BoardTodosSchema } from "./todos.js";
import { BoardParkingLotSchema } from "./parking-lot.js";
import { BoardDebugSchema } from "./debug.js";
import { PhaseIdSchema, PlanNumberSchema, PlanTextSchema, TextSchema } from "./safe-text.js";

const AvailabilitySchema = z.enum(["available", "unavailable"]);
const CountSchema = z.number().int().nonnegative();
const PercentSchema = z.number().min(0).max(100).nullable();
const RequirementsPercentSchema = z.number().int().min(0).max(100).nullable();

export const BoardOverviewWarningSchema = z.enum([
  "state-unavailable", "roadmap-unavailable", "state-malformed", "roadmap-malformed",
  "roadmap-limited", "plan-count-conflict", "phase-not-in-roadmap",
  "requirements-unavailable", "requirements-malformed", "requirements-scope-unknown", "requirements-trace-conflict", "requirements-limited",
]);

export const BoardOverviewStateSchema = z.object({
  availability: AvailabilitySchema,
  milestone: TextSchema(64).nullable(),
  milestoneName: TextSchema(200).nullable(),
  phaseId: PhaseIdSchema.nullable(),
  phaseName: TextSchema(640).nullable(),
  status: TextSchema(640).nullable(),
  plan: TextSchema(640).nullable(),
  lastActivity: TextSchema(640).nullable(),
  updatedAt: TextSchema(64).nullable(),
}).strict();

export const BoardOverviewPhaseSchema = z.object({
  id: PhaseIdSchema,
  title: TextSchema(640),
  completed: z.boolean(),
  current: z.boolean(),
  completedPlans: CountSchema.nullable(),
  totalPlans: CountSchema.nullable(),
  percent: PercentSchema,
}).strict();

export const BoardOverviewRoadmapSchema = z.object({
  availability: AvailabilitySchema,
  phases: z.array(BoardOverviewPhaseSchema).max(256),
  completedPhases: CountSchema.max(256),
  totalPhases: CountSchema.max(256),
  percent: PercentSchema,
}).strict();

export const BoardOverviewRequirementsSchema = z.object({
  availability: AvailabilitySchema,
  completed: CountSchema.max(256),
  total: CountSchema.max(256),
  percent: RequirementsPercentSchema,
  mapped: CountSchema.max(256).nullable(),
}).strict().superRefine((value, context) => {
  if (value.completed > value.total || (value.mapped !== null && value.mapped > value.total) || (value.total === 0 && value.percent !== null) ||
    (value.availability === "unavailable" && (value.completed !== 0 || value.total !== 0 || value.percent !== null || value.mapped !== null))) {
    context.addIssue({ code: "custom", message: "inconsistent requirements counts" });
  }
});

export const BoardOverviewPlanEntrySchema = z.object({
  id: TextSchema(129).regex(/^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))*-(?:0|[1-9]\d*)$/),
  number: PlanNumberSchema,
  title: PlanTextSchema(160).nullable(),
  objective: PlanTextSchema(640).nullable(),
  wave: CountSchema.nullable(),
  roadmapChecked: z.boolean().nullable(),
  roadmapConflict: z.boolean(),
  planObserved: z.boolean(),
  summaryObserved: z.boolean(),
  summaryExcerpt: PathFreeTextSchema(640).nullable(),
  summaryExcerptLimited: z.boolean(),
}).strict().superRefine((value, context) => {
  if (value.roadmapConflict && value.roadmapChecked !== null) context.addIssue({ code: "custom", message: "conflicting roadmap status must be unknown" });
  if (!value.summaryObserved && (value.summaryExcerpt !== null || value.summaryExcerptLimited)) context.addIssue({ code: "custom", message: "summary excerpts require a readable summary" });
});

export const BoardOverviewCheckEvidenceSchema = z.object({
  observation: z.enum(["observed", "not_observed", "unavailable"]),
  reportedStatus: z.enum(["draft", "pending", "validated", "passed", "complete", "clean", "gaps_found", "human_needed", "unknown", "verified", "warning", "open", "resolved", "partial", "failed"]).nullable(),
  compliant: z.boolean().nullable(),
}).strict();

const PlanChecksSchema = z.object({
  spec: BoardOverviewCheckEvidenceSchema, skeleton: BoardOverviewCheckEvidenceSchema, security: BoardOverviewCheckEvidenceSchema,
  patterns: BoardOverviewCheckEvidenceSchema, uiSpec: BoardOverviewCheckEvidenceSchema, aiSpec: BoardOverviewCheckEvidenceSchema,
  planCheck: BoardOverviewCheckEvidenceSchema, uiCheck: BoardOverviewCheckEvidenceSchema, nyquist: BoardOverviewCheckEvidenceSchema,
  windows: BoardOverviewCheckEvidenceSchema, deferred: BoardOverviewCheckEvidenceSchema,
}).strict();
const ExecuteChecksSchema = z.object({
  codeReview: BoardOverviewCheckEvidenceSchema, uiReview: BoardOverviewCheckEvidenceSchema,
  evalReview: BoardOverviewCheckEvidenceSchema, uat: BoardOverviewCheckEvidenceSchema, coverage: BoardOverviewCheckEvidenceSchema,
}).strict();
const PhaseChecksSchema = z.object({
  discuss: BoardOverviewCheckEvidenceSchema, research: BoardOverviewCheckEvidenceSchema,
  plan: PlanChecksSchema, execute: ExecuteChecksSchema, verify: BoardOverviewCheckEvidenceSchema,
}).strict();

export const BoardOverviewPlansSchema = z.object({
  availability: AvailabilitySchema,
  phases: z.array(z.object({
    id: PhaseIdSchema,
    title: TextSchema(640),
    current: z.boolean(),
    declaredPlans: CountSchema.nullable(),
    entries: z.array(BoardOverviewPlanEntrySchema).max(128),
    checks: PhaseChecksSchema,
  }).strict()).max(256),
  observedPlans: CountSchema.max(512),
  observedSummaries: CountSchema.max(512),
  limited: z.boolean(),
}).strict().superRefine((value, context) => {
  if (value.phases.reduce((count, phase) => count + phase.entries.length, 0) > 512 ||
    (value.availability === "unavailable" && (value.phases.length || value.observedPlans || value.observedSummaries))) {
    context.addIssue({ code: "custom", message: "inconsistent plans scope or limit" });
  }
});

export const BoardOverviewSchema = z.object({
  state: BoardOverviewStateSchema,
  roadmap: BoardOverviewRoadmapSchema,
  requirements: BoardOverviewRequirementsSchema,
  plans: BoardOverviewPlansSchema,
  context: BoardContextSchema,
  validation: BoardValidationSchema,
  uat: BoardUatSchema,
  verification: BoardVerificationSchema,
  todos: BoardTodosSchema,
  parkingLot: BoardParkingLotSchema,
  debug: BoardDebugSchema,
  warnings: z.array(BoardOverviewWarningSchema).max(12),
}).strict();

export type BoardOverview = z.infer<typeof BoardOverviewSchema>;
