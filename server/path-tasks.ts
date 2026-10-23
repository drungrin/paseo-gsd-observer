import { PathTaskSchema, PathTasksSchema, PathWaveSchema, type PathTask, type PathTasks, type PathWarning, type PathWave } from "../shared/path.js";
import type { AllowedInventory } from "./allowed-reader.js";
import { atxHeading } from "./document-text.js";
import { dashed, firstLabelled, headings, pathDocument, pathFrontmatter, proseLines, shortExcerpt, taskIdPattern, token, withoutComments } from "./path-text.js";

const maxTasks = 512;
const maxWaves = 64;
const memberPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const taskKey = /^tasks\/(T\d{3,6})-[^/]+\.md$/;
const emptyCounts = (): PathTasks["counts"] => ({ total: 0, done: 0, inProgress: 0, pending: 0, failed: 0, blocked: 0, other: 0 });
export const emptyTasks = (availability: PathTasks["availability"]): PathTasks => ({ availability, planObserved: false, waves: [], unassigned: [], counts: emptyCounts(), currentWave: null, limited: false });

type PlanWave = { number: number; name: string | null; goal: string | null; goalShortened: boolean };

/** `## Wave N — name` sections of PLAN.md and their `Goal:` lines. */
function planWaves(inventory: AllowedInventory, warnings: Set<PathWarning>): { observed: boolean; waves: Map<number, PlanWave> } {
  const waves = new Map<number, PlanWave>();
  const document = inventory.artifacts.find((item) => item.kind === "path-plan");
  if (!document) {
    if (inventory.problems.some((item) => item.kind === "path-plan")) warnings.add("plan-unavailable");
    return { observed: false, waves };
  }
  const text = pathDocument(document.bytes);
  const lines = text === null ? null : proseLines(withoutComments(text));
  if (!lines) { warnings.add("plan-malformed"); return { observed: false, waves }; }
  for (const section of headings(lines, 2)) {
    const { lead, rest } = dashed(section.heading);
    const number = /^Wave\s+(\d{1,4})$/i.exec(lead)?.[1];
    if (!number) continue;
    if (waves.has(Number(number))) { warnings.add("plan-malformed"); continue; }
    const goal = shortExcerpt(firstLabelled(section.lines, "Goal"), 640);
    waves.set(Number(number), { number: Number(number), name: shortExcerpt(rest, 200).text, goal: goal.text, goalShortened: goal.shortened });
  }
  return { observed: true, waves };
}

function readTask(key: string, bytes: Uint8Array, warnings: Set<PathWarning>): PathTask | null {
  const id = taskKey.exec(key)?.[1];
  const text = pathDocument(bytes);
  const fields = text === null ? null : pathFrontmatter(text);
  if (!id || !fields) { warnings.add("task-malformed"); return null; }
  const { values, lists } = fields;
  const recordedId = values.get("id");
  const idConflict = recordedId !== undefined && recordedId !== id;
  if (idConflict) warnings.add("task-id-conflict");
  const wave = /^\d{1,4}$/.test(values.get("wave") ?? "") ? Number(values.get("wave")) : null;
  const heading = proseLines(withoutComments(fields.body))?.map((line) => atxHeading(line, 0)).find((entry) => entry?.level === 1);
  const headingTitle = heading ? dashed(heading.text) : null;
  const ids = (key: string) => [...new Set((lists.get(key) ?? []).filter((item) => taskIdPattern.test(item)))].slice(0, 64);
  const repo = values.get("repo");
  const task: PathTask = {
    id, title: shortExcerpt(values.get("title") ?? (headingTitle?.lead === id ? headingTitle.rest : null), 240).text,
    status: token(values.get("status")), wave, deps: ids("deps"), supersedes: ids("supersedes"),
    repo: repo && memberPattern.test(repo) ? repo : null,
    files: Math.min(lists.get("files")?.length ?? 0, 100_000), idConflict,
  };
  if (PathTaskSchema.safeParse(task).success) return task;
  return PathTaskSchema.safeParse({ ...task, title: null }).success ? { ...task, title: null } : null;
}

const countKey = (status: string | null): keyof PathTasks["counts"] => status === "done" ? "done" : status === "in-progress" ? "inProgress"
  : status === "pending" ? "pending" : status === "failed" ? "failed" : status === "blocked" ? "blocked" : "other";

/** Waves from PLAN.md joined with the task files' own `wave:` numbers; a task's recorded status is shown as written, never inferred. */
export function buildTasks(inventory: AllowedInventory, warnings: Set<PathWarning>): PathTasks {
  const plan = planWaves(inventory, warnings);
  const taskProblems = inventory.problems.filter((item) => item.kind === "path-task");
  if (taskProblems.length) warnings.add("tasks-unavailable");
  const tasks: PathTask[] = [];
  const ids = new Set<string>();
  for (const document of inventory.artifacts.filter((item) => item.kind === "path-task").sort((left, right) => left.key.localeCompare(right.key))) {
    const task = readTask(document.key, document.bytes, warnings);
    if (!task) continue;
    if (ids.has(task.id)) warnings.add("task-duplicate");
    ids.add(task.id);
    tasks.push(task);
  }
  if (!plan.observed && !tasks.length) return emptyTasks(taskProblems.length || warnings.has("plan-unavailable") || warnings.has("plan-malformed") ? "unavailable" : "absent");
  let limited = taskProblems.some((item) => item.warning === "limit-reached" || item.warning === "observation-limited") || tasks.length > maxTasks;
  const listed = tasks.slice(0, maxTasks);
  const counts = emptyCounts();
  for (const task of listed) { counts.total += 1; counts[countKey(task.status)] += 1; }
  const unfinished = listed.filter((task) => task.status !== "done" && task.wave !== null).map((task) => task.wave as number);
  const currentWave = unfinished.length ? Math.min(...unfinished) : null;
  const numbers = [...new Set([...plan.waves.keys(), ...listed.flatMap((task) => task.wave === null ? [] : [task.wave])])].sort((left, right) => left - right);
  if (numbers.length > maxWaves) limited = true;
  const waves: PathWave[] = numbers.slice(0, maxWaves).map((number) => {
    const recorded = plan.waves.get(number);
    const wave: PathWave = { number, name: recorded?.name ?? null, goal: recorded?.goal ?? null, goalShortened: recorded?.goalShortened ?? false, inPlan: Boolean(recorded), current: number === currentWave, tasks: listed.filter((task) => task.wave === number) };
    return PathWaveSchema.safeParse(wave).success ? wave : { ...wave, name: null, goal: null };
  });
  const board: PathTasks = { availability: "available", planObserved: plan.observed, waves, unassigned: listed.filter((task) => task.wave === null), counts, currentWave, limited };
  return PathTasksSchema.safeParse(board).success ? board : { ...emptyTasks("unavailable"), limited: true };
}
