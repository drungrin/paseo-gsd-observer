import { z } from "zod";
import { ValidationTextSchema } from "./validation.js";

const ProseSchema = ValidationTextSchema;
const CountSchema = z.number().int().nonnegative();
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();

export const UAT_RESULT_KINDS = ["pass", "issue", "pending", "skipped", "blocked", "other"] as const;
export const UAT_SOURCE_KINDS = ["automated", "human", "evidence", "other", "unrecorded"] as const;
export const UAT_SEVERITY_LEVELS = ["blocker", "major", "minor", "cosmetic", "other"] as const;
export type UatResultKind = typeof UAT_RESULT_KINDS[number];
export type UatSourceKind = typeof UAT_SOURCE_KINDS[number];
const counts = <K extends string>(keys: readonly K[]) => z.object(Object.fromEntries(keys.map((key) => [key, CountSchema.max(4096)])) as Record<K, z.ZodNumber>).strict();

const SeveritySchema = z.object({ level: z.enum(UAT_SEVERITY_LEVELS), label: ProseSchema(48).nullable() }).strict();
const TestSchema = z.object({
  number: CountSchema.max(99_999).nullable(),
  name: ProseSchema(320).nullable(),
  expected: ProseSchema(640).nullable(),
  expectedSameAsName: z.boolean(),
  result: z.object({ kind: z.enum(UAT_RESULT_KINDS), label: ProseSchema(48).nullable(), note: ProseSchema(240).nullable() }).strict(),
  source: z.object({ kind: z.enum(UAT_SOURCE_KINDS), label: ProseSchema(64).nullable() }).strict(),
  previousResult: ProseSchema(48).nullable(),
  severity: SeveritySchema.nullable(),
  reported: ProseSchema(640).nullable(),
  resolvedBy: ProseSchema(240).nullable(),
  reason: ProseSchema(240).nullable(),
  reference: ProseSchema(64).nullable(),
  history: z.boolean(),
}).strict();
const RecordSchema = z.object({
  gap: z.boolean(),
  conflicting: z.boolean(),
  id: ProseSchema(64).nullable(),
  title: ProseSchema(640).nullable(),
  status: ProseSchema(64).nullable(),
  statusKind: z.enum(["open", "resolved", "deferred", "other"]).nullable(),
  originalStatus: ProseSchema(64).nullable(),
  severity: SeveritySchema.nullable(),
  test: CountSchema.max(99_999).nullable(),
  reason: ProseSchema(640).nullable(),
  rootCause: ProseSchema(640).nullable(),
  resolvedBy: ProseSchema(240).nullable(),
  decision: ProseSchema(240).nullable(),
  date: DateSchema,
  references: CountSchema.max(1024),
}).strict();
const RecordSectionSchema = z.object({ title: ProseSchema(120), role: z.enum(["gaps", "records"]), items: z.array(RecordSchema).max(32), itemCount: CountSchema.max(1024) }).strict();
const SummaryKeys = ["total", "passed", "issues", "pending", "skipped", "blocked"] as const;
const SummarySchema = z.object({
  ...Object.fromEntries(SummaryKeys.map((key) => [key, CountSchema.max(99_999).nullable()])) as Record<typeof SummaryKeys[number], z.ZodNullable<z.ZodNumber>>,
  extras: z.array(z.object({ label: ProseSchema(64), count: CountSchema.max(99_999) }).strict()).max(4),
  narrativeNotes: CountSchema.max(64),
  compared: CountSchema.max(6),
  ambiguous: z.array(z.enum(SummaryKeys)).max(6),
  mismatches: z.array(z.object({ field: z.enum(SummaryKeys), recorded: CountSchema.max(99_999), observed: CountSchema.max(4096) }).strict()).max(6),
}).strict();

export const BoardUatPhaseSchema = z.object({
  id: z.string().regex(/^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))*$/).max(64),
  title: ProseSchema(640),
  current: z.boolean(),
  observation: z.enum(["observed", "not_observed", "unavailable"]),
  recordedStatus: ProseSchema(64).nullable(),
  startedAt: DateSchema,
  updatedAt: DateSchema,
  currentTest: z.object({ state: z.enum(["complete", "in_progress", "recorded"]), number: CountSchema.max(99_999).nullable(), text: ProseSchema(320).nullable() }).strict().nullable(),
  testCount: CountSchema.max(4096),
  results: counts(UAT_RESULT_KINDS),
  sources: counts(UAT_SOURCE_KINDS),
  resolvedIssues: CountSchema.max(4096),
  gapCount: CountSchema.max(8192),
  openGapCount: CountSchema.max(8192),
  tests: z.array(TestSchema).max(256),
  summary: SummarySchema.nullable(),
  records: z.array(RecordSectionSchema).max(8),
  otherSections: z.array(z.object({ title: ProseSchema(120), lines: z.array(ProseSchema(640)).max(4) }).strict()).max(8),
  excerptsLimited: z.boolean(),
}).strict();

export const BoardUatSchema = z.object({
  availability: z.enum(["available", "unavailable"]),
  phases: z.array(BoardUatPhaseSchema).max(256),
  limited: z.boolean(),
}).strict();

export type BoardUat = z.infer<typeof BoardUatSchema>;
export type BoardUatPhase = z.infer<typeof BoardUatPhaseSchema>;
export type UatTest = BoardUatPhase["tests"][number];
export type UatRecordSection = BoardUatPhase["records"][number];
