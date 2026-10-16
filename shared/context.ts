import { z } from "zod";
import { maskPaths } from "./locations.js";
import { memoizeByLength, PlanTextSchema } from "./safe-text.js";

/** Plan prose rules plus no e-mail address, IPv4 address or dotted host name; displayable paths and file names are not hosts. */
export const ContextTextSchema = memoizeByLength((max: number) => z.string().max(max)
  .refine((value) => PlanTextSchema(max).safeParse(value).success)
  .refine((value) => !/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|\b(?:\d{1,3}\.){3}\d{1,3}\b|\b[a-z0-9](?:[a-z0-9-]*\.)+[a-z][a-z0-9-]*\b/i.test(maskPaths(value))));
const ProseSchema = ContextTextSchema;

const SectionSchema = z.object({ title: ProseSchema(120), lines: z.array(ProseSchema(640)).max(12) }).strict();
/**
 * A numbered context item: one letter, a number that may be phase-scoped ("D-12.1-01") or lettered ("D-10a"), and optionally
 * more of them as a range or list ("D-01..D-04", "D-05/D-06", "D-05/06").
 */
export const decisionIdPattern = "[A-Z]-\\d+(?:\\.\\d+)*(?:-\\d+)?[a-z]?(?:(?:\\.\\.|\\/)(?:[A-Z]-)?\\d+(?:\\.\\d+)*(?:-\\d+)?[a-z]?)*";
const DecisionSchema = z.object({ id: z.string().max(64).regex(new RegExp(`^${decisionIdPattern}$`)), title: ProseSchema(240).nullable(), text: ProseSchema(640) }).strict();
const DecisionGroupSchema = z.object({ title: ProseSchema(120), decisions: z.array(DecisionSchema).max(32) }).strict();

export const BoardContextPhaseSchema = z.object({
  id: z.string().regex(/^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))*$/).max(64),
  title: ProseSchema(640),
  current: z.boolean(),
  observation: z.enum(["observed", "not_observed", "unavailable"]),
  gatheredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  recordedStatus: ProseSchema(64).nullable(),
  boundary: z.array(ProseSchema(640)).max(3),
  decisionCount: z.number().int().nonnegative().max(128),
  decisionGroups: z.array(DecisionGroupSchema).max(12),
  discretion: z.array(ProseSchema(640)).max(8),
  specifics: z.array(ProseSchema(640)).max(8),
  deferred: z.array(ProseSchema(640)).max(8),
  referencesObserved: z.boolean(),
  amendmentsObserved: z.boolean(),
  insights: z.array(SectionSchema).max(4),
  sourceSections: z.array(SectionSchema).max(8),
  excerptsLimited: z.boolean(),
}).strict();

export const BoardContextSchema = z.object({
  availability: z.enum(["available", "unavailable"]),
  phases: z.array(BoardContextPhaseSchema).max(256),
  limited: z.boolean(),
}).strict();

export type BoardContext = z.infer<typeof BoardContextSchema>;
export type BoardContextPhase = z.infer<typeof BoardContextPhaseSchema>;
