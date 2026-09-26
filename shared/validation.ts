import { z } from "zod";
import { ContextTextSchema } from "./context.js";
import { memoizeByLength } from "./safe-text.js";

// Numeric segments allow at most two dots ("59.2", "16.1.1") so an IPv4 address never reads as an identifier.
const segment = "\\d+(?:\\.\\d+){0,2}";
const reference = new RegExp(`^[A-Z][A-Z0-9]*(?:-${segment})+(?:(?:\\.\\.|\\/)(?:[A-Z][A-Z0-9]*-)?${segment}(?:-${segment})*)*$`);
const ratio = /^\d+(?:\/\d+)+$/;
const planReference = /^\d+(?:\.\d+){0,2}(?:-\d+)+\/[A-Z][A-Z0-9]*(?:-\d+)?$/;
/** References such as "BCFG-01/02", "D-05..D-08" or "59.1-01/D1" and counts such as "7/8" are identifiers, not locations or hostnames. */
export const isReferenceList = (token: string) => {
  const core = token.replace(/^[("“'‘*_`]+|[)"”'’,.;:!?*_`]+$/g, "");
  return !/(?:\d{1,3}\.){3}\d{1,3}/.test(core) && (reference.test(core) || ratio.test(core) || planReference.test(core));
};
export const maskReferenceLists = (value: string, replacement = "REF") => value.replace(/\S+/g, (token) => isReferenceList(token) ? replacement : token);
const masked = (value: string) => maskReferenceLists(value).replace(/\b(?:e\.g|i\.e)\./gi, "eg");
// IPv6 forms: any "::" compression, or four or more colon-separated hex groups.
export const ipv6 = /[0-9a-f]{0,4}::[0-9a-f]{0,4}|(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}/i;
/** Context prose rules plus host-like forms common in test documents: "@", localhost, ports, IPv6, underscore names and dotted file names. */
export const ValidationTextSchema = memoizeByLength((max: number) => z.string().max(max)
  .refine((value) => ContextTextSchema(max).safeParse(masked(value)).success)
  .refine((value) => !/@|\blocalhost\b|[\w-]\.[a-z_]|[a-z]:\d{2,5}\b|\S=\S/i.test(masked(value)) && !ipv6.test(masked(value))));
/** Validation prose with no slash token other than a reference list, so not even a partial path survives. */
export const PathFreeTextSchema = memoizeByLength((max: number) => ValidationTextSchema(max).refine((value) =>
  !value.split(/\s+/).some((token) => token.includes("/") && !isReferenceList(token))));
const ProseSchema = ValidationTextSchema;
const CellSchema = z.union([z.literal(""), ProseSchema(640)]).nullable();
const CountSchema = z.number().int().nonnegative();
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();

export const VALIDATION_STATUS_KINDS = ["passing", "pending", "failing", "partial", "human", "blocked", "flaky", "other"] as const;
export const ValidationStatusKindSchema = z.enum(VALIDATION_STATUS_KINDS);
const StatusCountsSchema = z.object(Object.fromEntries(VALIDATION_STATUS_KINDS.map((kind) => [kind, CountSchema.max(1024)])) as Record<typeof VALIDATION_STATUS_KINDS[number], z.ZodNumber>).strict();

const StatusSchema = z.object({ kind: ValidationStatusKindSchema, label: ProseSchema(48).nullable(), note: ProseSchema(240).nullable() }).strict();
const RowSchema = z.object({ key: ProseSchema(160).nullable(), cells: z.array(CellSchema).max(10), status: StatusSchema.nullable(), aligned: z.boolean() }).strict();
const TableSchema = z.object({
  title: ProseSchema(120),
  role: z.enum(["verification", "escalated", "manual"]),
  keyLabel: ProseSchema(80),
  columns: z.array(ProseSchema(80)).max(10),
  statusLabel: ProseSchema(80).nullable(),
  hiddenColumns: z.array(ProseSchema(80)).max(8),
  rows: z.array(RowSchema).max(64),
  rowCount: CountSchema.max(1024),
  irregularRows: CountSchema.max(1024),
  counts: StatusCountsSchema.nullable(),
  conflicts: CountSchema.max(1024),
}).strict();
const ChecklistSchema = z.object({ done: CountSchema.max(256), total: CountSchema.max(256), open: z.array(ProseSchema(640)).max(12), note: ProseSchema(640).nullable() }).strict();
const FieldSchema = z.object({ label: ProseSchema(80), value: ProseSchema(240).nullable(), withheld: z.enum(["command", "unsafe"]).nullable() }).strict();
const AuditSchema = z.object({ title: ProseSchema(120), date: DateSchema, gaps: CountSchema.nullable(), resolved: CountSchema.nullable(), escalated: CountSchema.nullable() }).strict();

export const BoardValidationPhaseSchema = z.object({
  id: z.string().regex(/^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))*$/).max(64),
  title: ProseSchema(640),
  current: z.boolean(),
  observation: z.enum(["observed", "not_observed", "unavailable"]),
  recordedStatus: ProseSchema(64).nullable(),
  nyquistCompliant: z.boolean().nullable(),
  wave0Complete: z.boolean().nullable(),
  createdAt: DateSchema,
  updatedAt: DateSchema,
  otherStatuses: z.array(z.object({ label: ProseSchema(64), value: ProseSchema(64) }).strict()).max(4),
  infrastructure: z.array(FieldSchema).max(12),
  tables: z.array(TableSchema).max(6),
  manualNote: ProseSchema(640).nullable(),
  wave0: ChecklistSchema.nullable(),
  signOff: ChecklistSchema.nullable(),
  audits: z.array(AuditSchema).max(8),
  auditCount: CountSchema.max(64),
  sections: z.array(ProseSchema(120)).max(32),
  excerptsLimited: z.boolean(),
}).strict();

export const BoardValidationSchema = z.object({
  availability: z.enum(["available", "unavailable"]),
  phases: z.array(BoardValidationPhaseSchema).max(256),
  limited: z.boolean(),
}).strict();

export type BoardValidation = z.infer<typeof BoardValidationSchema>;
export type BoardValidationPhase = z.infer<typeof BoardValidationPhaseSchema>;
export type ValidationTable = BoardValidationPhase["tables"][number];
export type ValidationStatusKind = z.infer<typeof ValidationStatusKindSchema>;
