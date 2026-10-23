import { z } from "zod";
import { ValidationTextSchema } from "./validation.js";

/** What the board publishes for a GSD Path workspace (`.project/`): recorded facts only, never the runtime's route, completion or Git proof. */

const CountSchema = z.number().int().nonnegative().max(100_000);
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ProseSchema = ValidationTextSchema;
/** Recorded lowercase words (phase, status, integration, verdict) pass through as written, so values only one edition uses still show. */
export const PathTokenSchema = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);
const SlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,127}$/);
const BranchSchema = z.string().regex(/^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/);
export const MilestoneIdSchema = z.string().regex(/^M\d{3,6}$/);
export const TaskIdSchema = z.string().regex(/^T\d{3,6}$/);
const MemberSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);

export const PATH_PHASES = ["inspect", "define", "research", "decide", "roadmap", "plan", "build", "ship", "shipped"] as const;
export const PATH_TASK_STATUSES = ["pending", "in-progress", "done", "failed", "blocked"] as const;

export const PATH_WARNINGS = [
  "state-unavailable", "state-malformed", "log-unavailable",
  "roadmap-unavailable", "roadmap-malformed", "milestone-not-in-roadmap",
  "plan-unavailable", "plan-malformed", "tasks-unavailable", "task-malformed", "task-id-conflict", "task-duplicate",
  "next-unavailable", "evidence-limited",
] as const;
export const PathWarningSchema = z.enum(PATH_WARNINGS);

export const PathLogEventSchema = z.object({
  date: DateSchema,
  phase: PathTokenSchema.nullable(),
  text: ProseSchema(640).nullable(),
  shortened: z.boolean(),
}).strict();

export const PathStateSchema = z.object({
  availability: z.enum(["available", "unavailable"]),
  project: SlugSchema.nullable(),
  milestone: SlugSchema.nullable(),
  phase: PathTokenSchema.nullable(),
  status: PathTokenSchema.nullable(),
  branch: BranchSchema.nullable(),
  defaultBranch: BranchSchema.nullable(),
  integration: PathTokenSchema.nullable(),
  integrationDefault: PathTokenSchema.nullable(),
  /** `phase: shipped` with `status: done`, as recorded; the observer never verifies integration. */
  shipped: z.boolean(),
  lastEvent: PathLogEventSchema.nullable(),
}).strict();

export const PathTimelineEntrySchema = z.object({
  phase: PathTokenSchema,
  since: DateSchema,
  latest: DateSchema,
  visits: z.number().int().min(1).max(100_000),
  current: z.boolean(),
}).strict();

export const PathTimelineSchema = z.object({
  availability: z.enum(["available", "unavailable"]),
  entries: z.array(PathTimelineEntrySchema).max(32),
  logEntries: CountSchema,
}).strict();

export const PathMilestoneSchema = z.object({
  id: MilestoneIdSchema,
  slug: SlugSchema.nullable(),
  status: PathTokenSchema.nullable(),
  goal: ProseSchema(400).nullable(),
  depends: z.array(MilestoneIdSchema).max(64),
  archived: z.boolean(),
  integrated: z.boolean(),
  current: z.boolean(),
}).strict();

export const PathRoadmapSchema = z.object({
  /** "absent" is normal: only program flow writes a roadmap. */
  availability: z.enum(["available", "absent", "unavailable"]),
  milestones: z.array(PathMilestoneSchema).max(128),
  counts: z.object({ total: CountSchema, shipped: CountSchema, active: CountSchema, pending: CountSchema, abandoned: CountSchema, other: CountSchema }).strict(),
}).strict();

export const PathNextSchema = z.object({
  milestone: SlugSchema.nullable(),
  phase: PathTokenSchema.nullable(),
  status: PathTokenSchema.nullable(),
}).strict();

export const PathTaskSchema = z.object({
  id: TaskIdSchema,
  title: ProseSchema(240).nullable(),
  status: PathTokenSchema.nullable(),
  wave: z.number().int().nonnegative().max(9_999).nullable(),
  deps: z.array(TaskIdSchema).max(64),
  supersedes: z.array(TaskIdSchema).max(64),
  /** The MEMBERS.md member a multi-repo task changes; null for the coordinator or a single repository. */
  repo: MemberSchema.nullable(),
  files: CountSchema,
  /** The file name and the recorded `id:` disagree; the file name is used. */
  idConflict: z.boolean(),
}).strict();

export const PathWaveSchema = z.object({
  number: z.number().int().nonnegative().max(9_999),
  name: ProseSchema(200).nullable(),
  goal: ProseSchema(640).nullable(),
  goalShortened: z.boolean(),
  inPlan: z.boolean(),
  current: z.boolean(),
  tasks: z.array(PathTaskSchema).max(512),
}).strict();

export const PathTaskCountsSchema = z.object({
  total: CountSchema, done: CountSchema, inProgress: CountSchema, pending: CountSchema, failed: CountSchema, blocked: CountSchema, other: CountSchema,
}).strict();

export const PathTasksSchema = z.object({
  availability: z.enum(["available", "absent", "unavailable"]),
  planObserved: z.boolean(),
  waves: z.array(PathWaveSchema).max(64),
  /** Tasks with no readable wave number. */
  unassigned: z.array(PathTaskSchema).max(512),
  counts: PathTaskCountsSchema,
  currentWave: z.number().int().nonnegative().max(9_999).nullable(),
  limited: z.boolean(),
}).strict().superRefine((value, context) => {
  if (value.waves.reduce((total, wave) => total + wave.tasks.length, value.unassigned.length) > 512) context.addIssue({ code: "custom", message: "too many tasks" });
});

export const BoardPathSchema = z.object({
  /** "unsupported": `.project/STATE.md` names another GSD Path pipeline format, so nothing else is parsed. */
  setup: z.enum(["started", "not-started", "unsupported"]),
  state: PathStateSchema,
  timeline: PathTimelineSchema,
  roadmap: PathRoadmapSchema,
  next: PathNextSchema.nullable(),
  tasks: PathTasksSchema,
  warnings: z.array(PathWarningSchema).max(16),
}).strict();

export type BoardPath = z.infer<typeof BoardPathSchema>;
export type PathState = z.infer<typeof PathStateSchema>;
export type PathTimeline = z.infer<typeof PathTimelineSchema>;
export type PathRoadmap = z.infer<typeof PathRoadmapSchema>;
export type PathMilestone = z.infer<typeof PathMilestoneSchema>;
export type PathTasks = z.infer<typeof PathTasksSchema>;
export type PathTask = z.infer<typeof PathTaskSchema>;
export type PathWave = z.infer<typeof PathWaveSchema>;
export type PathWarning = z.infer<typeof PathWarningSchema>;
