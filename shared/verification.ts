import { z } from "zod";
import { ValidationTextSchema } from "./validation.js";

const ProseSchema = ValidationTextSchema;
const CountSchema = z.number().int().nonnegative();
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();

/** Recorded row states from goal-backward verification tables (truths, artifacts, links, requirements and the like). */
export const VERIFICATION_ROW_KINDS = ["verified", "failed", "partial", "unverified", "human", "pending", "uncertain", "override", "deferred", "other"] as const;
export const VERIFICATION_CHECK_FAMILIES = ["artifacts", "links", "dataflow", "behavior", "requirements", "decisions", "tests", "antipatterns", "prohibitions", "advisory", "deferred", "other"] as const;
export const VERIFICATION_SEVERITIES = ["blocker", "warning", "info", "other"] as const;
export const VERIFICATION_STATUS_KINDS = ["passed", "gaps_found", "human_needed", "other"] as const;
export type VerificationRowKind = typeof VERIFICATION_ROW_KINDS[number];
export type VerificationCheckFamily = typeof VERIFICATION_CHECK_FAMILIES[number];
export type VerificationSeverity = typeof VERIFICATION_SEVERITIES[number];
const counts = <K extends string>(keys: readonly K[]) => z.object(Object.fromEntries(keys.map((key) => [key, CountSchema.max(1024)])) as Record<K, z.ZodNumber>).strict();

const RowStatusSchema = z.object({ kind: z.enum(VERIFICATION_ROW_KINDS), label: ProseSchema(48).nullable(), note: ProseSchema(240).nullable() }).strict();
// "aligned" is false when a row's cells do not line up with the header, so its status is not attributed.
const TruthRowSchema = z.object({ key: ProseSchema(64).nullable(), text: ProseSchema(640).nullable(), status: RowStatusSchema.nullable(), evidence: ProseSchema(480).nullable(), aligned: z.boolean() }).strict();
const TruthTableSchema = z.object({ title: ProseSchema(120), textLabel: ProseSchema(80).nullable(), rowCount: CountSchema.max(1024), counts: counts(VERIFICATION_ROW_KINDS), rows: z.array(TruthRowSchema).max(64) }).strict();
const CheckRowSchema = z.object({ key: ProseSchema(120).nullable(), status: RowStatusSchema.nullable(), severity: z.enum(VERIFICATION_SEVERITIES).nullable(), detail: ProseSchema(320).nullable(), aligned: z.boolean() }).strict();
const CheckTableSchema = z.object({
  title: ProseSchema(120),
  family: z.enum(VERIFICATION_CHECK_FAMILIES),
  rowCount: CountSchema.max(1024),
  // Counts cover every row; severities only when the table records a severity column.
  counts: counts(VERIFICATION_ROW_KINDS),
  severities: counts(VERIFICATION_SEVERITIES).nullable(),
  statusRecorded: z.boolean(),
  rows: z.array(CheckRowSchema).max(24),
  listed: z.enum(["all", "attention"]),
}).strict();
const GapSchema = z.object({
  truth: ProseSchema(640).nullable(),
  status: ProseSchema(64).nullable(),
  statusKind: z.enum(["open", "partial", "closed", "deferred", "other"]).nullable(),
  previousStatus: ProseSchema(64).nullable(),
  reason: ProseSchema(640).nullable(),
  missing: CountSchema.max(1024),
  artifacts: CountSchema.max(1024),
  closedAt: DateSchema,
  closedBy: ProseSchema(240).nullable(),
  conflicting: z.boolean(),
}).strict();
const HumanCheckSchema = z.object({
  test: ProseSchema(640).nullable(),
  expected: ProseSchema(640).nullable(),
  whyHuman: ProseSchema(640).nullable(),
  // "recorded" means an outcome is written but its wording is not classified as resolved or open.
  state: z.enum(["resolved", "open", "recorded"]),
  resolvedAt: DateSchema,
  resolution: ProseSchema(480).nullable(),
}).strict();
const BehaviorItemSchema = z.object({ truth: ProseSchema(640).nullable(), test: ProseSchema(640).nullable(), expected: ProseSchema(640).nullable(), whyHuman: ProseSchema(640).nullable() }).strict();
const OverrideSchema = z.object({ mustHave: ProseSchema(640).nullable(), reason: ProseSchema(640).nullable(), acceptedAt: DateSchema }).strict();
const ReVerificationSchema = z.object({
  previousStatus: ProseSchema(64).nullable(),
  previousScore: ProseSchema(120).nullable(),
  gapsClosed: CountSchema.max(1024),
  gapsRemaining: CountSchema.max(1024),
  regressions: CountSchema.max(1024),
  remaining: z.array(ProseSchema(640)).max(8),
  regressionItems: z.array(ProseSchema(640)).max(8),
}).strict();

export const BoardVerificationPhaseSchema = z.object({
  id: z.string().regex(/^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))*$/).max(64),
  title: ProseSchema(640),
  current: z.boolean(),
  observation: z.enum(["observed", "not_observed", "unavailable"]),
  recordedStatus: ProseSchema(64).nullable(),
  statusKind: z.enum(VERIFICATION_STATUS_KINDS).nullable(),
  // The status line some reports repeat in their body, kept only when it names a different status than the header.
  bodyStatus: ProseSchema(64).nullable(),
  verifiedAt: DateSchema,
  disposedAt: DateSchema,
  score: z.object({ verified: CountSchema.max(99_999).nullable(), total: CountSchema.max(99_999).nullable(), text: ProseSchema(240).nullable() }).strict().nullable(),
  behaviorUnverified: CountSchema.max(99_999).nullable(),
  overridesApplied: CountSchema.max(99_999).nullable(),
  reVerification: ReVerificationSchema.nullable(),
  gapCount: CountSchema.max(1024),
  openGapCount: CountSchema.max(1024),
  gaps: z.array(GapSchema).max(16),
  humanCount: CountSchema.max(1024),
  openHumanCount: CountSchema.max(1024),
  recordedHumanCount: CountSchema.max(1024),
  humanChecks: z.array(HumanCheckSchema).max(16),
  humanClosed: z.object({ date: DateSchema, by: ProseSchema(240).nullable() }).strict().nullable(),
  humanNote: ProseSchema(640).nullable(),
  behaviorCount: CountSchema.max(1024),
  behaviorItems: z.array(BehaviorItemSchema).max(8),
  overrideCount: CountSchema.max(1024),
  overrides: z.array(OverrideSchema).max(8),
  coincidentalCount: CountSchema.max(1024),
  deferredCount: CountSchema.max(1024),
  decisionCoverage: z.object({ honored: CountSchema.max(99_999).nullable(), total: CountSchema.max(99_999).nullable(), notHonored: CountSchema.max(1024) }).strict().nullable(),
  truthTables: z.array(TruthTableSchema).max(3),
  checks: z.array(CheckTableSchema).max(16),
  gapsSummary: ProseSchema(640).nullable(),
  laterSections: z.array(z.object({ title: ProseSchema(120), date: DateSchema, lines: z.array(ProseSchema(640)).max(2), tables: CountSchema.max(64) }).strict()).max(8),
  otherFields: z.array(ProseSchema(64)).max(8),
  otherSections: z.array(z.object({ title: ProseSchema(120), lines: z.array(ProseSchema(640)).max(3) }).strict()).max(12),
  excerptsLimited: z.boolean(),
}).strict();

export const BoardVerificationSchema = z.object({
  availability: z.enum(["available", "unavailable"]),
  phases: z.array(BoardVerificationPhaseSchema).max(256),
  limited: z.boolean(),
}).strict();

export type BoardVerification = z.infer<typeof BoardVerificationSchema>;
export type BoardVerificationPhase = z.infer<typeof BoardVerificationPhaseSchema>;
export type VerificationTruthTable = BoardVerificationPhase["truthTables"][number];
export type VerificationCheckTable = BoardVerificationPhase["checks"][number];
export type VerificationRowStatus = VerificationTruthTable["rows"][number]["status"];
