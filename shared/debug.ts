import { z } from "zod";
import { PathFreeTextSchema } from "./validation.js";

export const DEBUG_STATUS_KINDS = ["open", "diagnosed", "awaiting-verification", "blocked", "resolved", "other", "unrecorded"] as const;
export const DEBUG_LOCATIONS = ["active", "archived"] as const;
/** Disagreements between where a session file lives and what it records; each is shown, never resolved by the observer. */
export const DEBUG_NOTES = ["archived-unresolved", "resolved-not-archived", "resolution-status", "duplicate-slug"] as const;
export const DEBUG_BUG_CLASSES = ["bohrbug", "heisenbug-mandelbug", "concurrency"] as const;

const CountSchema = z.number().int().nonnegative().max(100_000);
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const ProseSchema = PathFreeTextSchema;

export const DebugSessionSchema = z.object({
  /** Opaque, stable within a workspace; never displayed. */
  id: z.string().regex(/^[0-9a-f]{12}$/),
  location: z.enum(DEBUG_LOCATIONS),
  slug: z.string().regex(/^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/).max(96).refine((value) => !/\d+(?:\.\d+){3}/.test(value)).nullable(),
  title: ProseSchema(200).nullable(),
  statusKind: z.enum(DEBUG_STATUS_KINDS),
  recordedStatus: ProseSchema(64).nullable(),
  goal: z.enum(["diagnose-only", "find-and-fix"]).nullable(),
  bugClass: z.enum(DEBUG_BUG_CLASSES).nullable(),
  phaseId: z.string().regex(/^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,2}$/).max(64).nullable(),
  createdAt: DateSchema,
  updatedAt: DateSchema,
  resolvedAt: DateSchema,
  notes: z.array(z.enum(DEBUG_NOTES)).max(DEBUG_NOTES.length),
  trigger: ProseSchema(480).nullable(),
  expected: ProseSchema(320).nullable(),
  actual: ProseSchema(320).nullable(),
  hypothesis: ProseSchema(480).nullable(),
  nextAction: ProseSchema(400).nullable(),
  rootCause: ProseSchema(640).nullable(),
  fix: ProseSchema(480).nullable(),
  verification: ProseSchema(320).nullable(),
  verificationStructured: z.boolean(),
  evidenceCount: CountSchema.nullable(),
  eliminatedCount: CountSchema.nullable(),
  filesChangedCount: CountSchema.nullable(),
  detailsWithheld: z.boolean(),
  excerptsLimited: z.boolean(),
}).strict();

export const BoardDebugSchema = z.object({
  availability: z.enum(["available", "unavailable"]),
  directoryState: z.enum(["observed", "absent", "unknown"]),
  archiveState: z.enum(["observed", "absent", "unknown"]),
  sessions: z.array(DebugSessionSchema).max(160),
  counts: z.object({
    active: CountSchema, archived: CountSchema, attention: CountSchema, unresolved: CountSchema,
    open: CountSchema, diagnosed: CountSchema, awaitingVerification: CountSchema, blocked: CountSchema, resolved: CountSchema, unclassified: CountSchema,
    reconciliation: CountSchema, unavailable: CountSchema, knowledgeBase: CountSchema, notes: CountSchema, displayed: CountSchema,
  }).strict(),
  countsComplete: z.boolean(),
  limited: z.boolean(),
}).strict();

export type DebugSession = z.infer<typeof DebugSessionSchema>;
export type BoardDebug = z.infer<typeof BoardDebugSchema>;
export type DebugStatusKind = DebugSession["statusKind"];
export type DebugLocation = DebugSession["location"];
export type DebugNote = DebugSession["notes"][number];
