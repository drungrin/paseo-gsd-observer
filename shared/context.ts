import { z } from "zod";
import { memoizeByLength, PlanTextSchema } from "./safe-text.js";

const alternative = /^[\p{L}][\p{L}\p{M}\p{N}-]*(?:\/[\p{L}][\p{L}\p{M}\p{N}-]*){1,3}$/u;
const locationRoot = /^(?:src|lib|app|apps|packages|node_modules|server|client|home|users|tmp|var|etc|planning|tests|scripts|docs|config|bin|opt|usr|private)$/i;
const directory = /^(?:src|lib|node_modules|tests?|e2e|specs?|bin|dist|components|pages|scripts|docs|fixtures|features|services|layout|public|assets|internal)$/i;
/** Plain word alternatives such as "read/write" are prose, not locations; a segment named like a source directory makes it a location. */
export const isWordAlternative = (token: string) => {
  const word = token.replace(/^[("“'‘*_`]+|[)"”'’,.;:!?*_`]+$/g, "");
  const segments = word.split("/");
  return alternative.test(word) && !locationRoot.test(segments[0]) && !segments.some((segment) => directory.test(segment));
};
export const maskWordAlternatives = (value: string, replacement: string) => value.replace(/\S*\/\S*/g, (token) => isWordAlternative(token) ? token.replace(/\//g, replacement) : token);
const maskAlternatives = (value: string) => maskWordAlternatives(value.replace(/(?<=\S) \/ (?=\S)/g, "   "), " ");
export const ContextTextSchema = memoizeByLength((max: number) => z.string().max(max)
  .refine((value) => PlanTextSchema(max).safeParse(maskAlternatives(value)).success)
  .refine((value) => !/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|\b(?:\d{1,3}\.){3}\d{1,3}\b|\b[a-z0-9](?:[a-z0-9-]*\.)+[a-z][a-z0-9-]*\b/i.test(value)));
const ProseSchema = ContextTextSchema;

const SectionSchema = z.object({ title: ProseSchema(120), lines: z.array(ProseSchema(640)).max(12) }).strict();
const DecisionGroupSchema = z.object({ title: ProseSchema(120), decisions: z.array(z.object({ id: z.string().regex(/^D-\d{2,3}$/), text: ProseSchema(640) }).strict()).max(32) }).strict();

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
