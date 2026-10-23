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
  "next-unavailable", "reviews-unavailable", "reviews-malformed", "questions-unavailable", "questions-malformed", "evidence-limited",
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

/** Review panel families are open-ended ("muse" exists only in a fork), so any lowercase name passes. */
const FamilySchema = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);
const FileNameSchema = z.string().regex(/^(?=.{1,200}$)[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*\.md$/);

export const PathPanelSchema = z.object({
  families: z.array(FamilySchema).max(16),
  actionable: CountSchema.nullable(),
  warnings: CountSchema.nullable(),
  conflicts: CountSchema.nullable(),
  /** Families whose own panel file was observed beside the summary. */
  familyFiles: z.array(FamilySchema).max(16),
}).strict();

export const PathWaveReviewSchema = z.object({
  wave: z.number().int().nonnegative().max(9_999),
  cycle: z.number().int().nonnegative().max(9_999),
  /** "contract" or "adversarial" for deep reviews, from the file name. */
  lens: PathTokenSchema.nullable(),
  verdict: PathTokenSchema.nullable(),
  depth: PathTokenSchema.nullable(),
  tasksReviewed: CountSchema.nullable(),
  tasks: z.array(z.object({ id: TaskIdSchema, verdict: z.enum(["pass", "fail"]) }).strict()).max(512),
  /** A later cycle of the same wave and lens recorded a pass or blocked verdict. */
  superseded: z.boolean(),
  panel: PathPanelSchema.nullable(),
}).strict();

export const PathCriterionSchema = z.object({
  id: z.string().regex(/^SC\d{1,4}$/).nullable(),
  text: ProseSchema(240).nullable(),
  verdict: PathTokenSchema.nullable(),
}).strict();

export const PathReviewSetSchema = z.object({
  waves: z.array(PathWaveReviewSchema).max(256),
  planPanel: PathPanelSchema.nullable(),
  final: z.object({ verdict: PathTokenSchema.nullable(), criteria: z.array(PathCriterionSchema).max(128) }).strict().nullable(),
  gaps: z.array(z.object({ number: z.number().int().nonnegative().max(9_999), verdict: PathTokenSchema.nullable(), risk: ProseSchema(200).nullable() }).strict()).max(64),
  patchFindings: z.boolean(),
  /** Review files with no recognized name, listed by name only. */
  otherFiles: z.array(FileNameSchema).max(64),
}).strict();

export const PathRecoverySchema = z.object({
  /** The first seven characters of the recovery's base commit, from its folder name. */
  base: z.string().regex(/^[0-9a-f]{7}$/),
  date: DateSchema.nullable(),
  /** The phase the recovery reopened, as its log entry records it. */
  kind: PathTokenSchema.nullable(),
  reviews: PathReviewSetSchema,
}).strict();

export const PathReviewsSchema = z.object({
  availability: z.enum(["available", "absent", "unavailable"]),
  current: PathReviewSetSchema,
  recoveries: z.array(PathRecoverySchema).max(32),
  limited: z.boolean(),
}).strict();

export const PathQuestionSchema = z.object({
  id: z.string().regex(/^A\d{3,6}$/),
  date: DateSchema.nullable(),
  topic: ProseSchema(200).nullable(),
  question: ProseSchema(400).nullable(),
  status: PathTokenSchema.nullable(),
  owner: ProseSchema(120).nullable(),
  target: ProseSchema(200).nullable(),
}).strict();

export const PathQuestionsSchema = z.object({
  /** "absent" is normal: discuss/ANSWERS.md exists only after a discussion. */
  availability: z.enum(["available", "absent", "unavailable"]),
  pending: z.array(PathQuestionSchema).max(128),
  counts: z.object({ answers: CountSchema, pending: CountSchema, closed: CountSchema }).strict(),
  limited: z.boolean(),
}).strict();

export const BoardPathSchema = z.object({
  /** "unsupported": `.project/STATE.md` names another GSD Path pipeline format, so nothing else is parsed. */
  setup: z.enum(["started", "not-started", "unsupported"]),
  state: PathStateSchema,
  timeline: PathTimelineSchema,
  roadmap: PathRoadmapSchema,
  next: PathNextSchema.nullable(),
  tasks: PathTasksSchema,
  reviews: PathReviewsSchema,
  questions: PathQuestionsSchema,
  warnings: z.array(PathWarningSchema).max(20),
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
export type PathPanel = z.infer<typeof PathPanelSchema>;
export type PathWaveReview = z.infer<typeof PathWaveReviewSchema>;
export type PathReviewSet = z.infer<typeof PathReviewSetSchema>;
export type PathRecovery = z.infer<typeof PathRecoverySchema>;
export type PathReviews = z.infer<typeof PathReviewsSchema>;
export type PathQuestion = z.infer<typeof PathQuestionSchema>;
export type PathQuestions = z.infer<typeof PathQuestionsSchema>;
