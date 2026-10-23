import type { BoardSnapshot } from "../shared/board-rpc.js";
import type { BoardOverview } from "../shared/overview.js";

/** What an automatic refresh found changed: the tasks to highlight and a few words for the banner and screen readers. */
export type BoardChanges = { at: number; tasks: string[]; summary: string[] };
/** `statusFailed`: the last status poll got no answer, so the board cannot tell whether the files changed. */
export type BoardReadingState = { workspaceId: string; snapshot: BoardSnapshot | null; busy: boolean; error: string | null; refreshAnnouncement: string | null; changes: BoardChanges | null; statusFailed: boolean };
export const createBoardState = (workspaceId: string): BoardReadingState => ({ workspaceId, snapshot: null, busy: false, error: null, refreshAnnouncement: null, changes: null, statusFailed: false });

const words = (token: string | null) => token ? token.replace(/-/g, " ") : "not recorded";
const allTasks = (snapshot: BoardSnapshot) => snapshot.path ? [...snapshot.path.tasks.waves.flatMap((wave) => wave.tasks), ...snapshot.path.tasks.unassigned] : [];

const count = (value: number, one: string, many = `${one}s`) => `${value} ${value === 1 ? one : many}`;

/** "T014 done", "phase build", "wave 2 review cycle 1 blocked", "new log entry": what changed in a GSD Path project. */
function pathChanges(previous: BoardSnapshot, next: BoardSnapshot): { tasks: string[]; summary: string[] } | null {
  const before = previous.path;
  const after = next.path;
  if (!before || !after) return null;
  const statuses = new Map(allTasks(previous).map((task) => [task.id, task.status]));
  const tasks: string[] = [];
  const summary: string[] = [];
  if (before.state.phase !== after.state.phase) summary.push(`phase ${words(after.state.phase)}`);
  for (const task of allTasks(next)) {
    if (!statuses.has(task.id)) { tasks.push(task.id); summary.push(`${task.id} added`); }
    else if (statuses.get(task.id) !== task.status) { tasks.push(task.id); summary.push(`${task.id} ${words(task.status)}`); }
  }
  const reviewed = new Set(before.reviews.current.waves.map((review) => `${review.wave}:${review.cycle}:${review.lens ?? ""}`));
  for (const review of after.reviews.current.waves.filter((entry) => !reviewed.has(`${entry.wave}:${entry.cycle}:${entry.lens ?? ""}`))) summary.push(`wave ${review.wave} review cycle ${review.cycle} ${words(review.verdict)}`);
  const asked = after.questions.counts.pending - before.questions.counts.pending;
  if (asked > 0) summary.push(`${count(asked, "new question")}`);
  const event = (path: typeof after) => path.state.lastEvent ? `${path.state.lastEvent.date}|${path.state.lastEvent.text ?? ""}` : null;
  if (event(after) && event(after) !== event(before)) summary.push("new log entry");
  return { tasks, summary };
}

/** "phase 62", "phase 61 complete", "plan 61-03 summary written", "2 UAT tests passed": what changed in a GSD Core project. */
function coreChanges(before: BoardOverview, after: BoardOverview): { tasks: string[]; summary: string[] } {
  const tasks: string[] = [];
  const summary: string[] = [];
  // A source is compared only between two readable reads, so evidence coming back after a failed or half-written read is not news.
  // The per-phase sources follow the roadmap's phases, so they also need a roadmap read whole both times.
  const readable = <T extends { availability: string }>(pick: (overview: BoardOverview) => T) => pick(before).availability === "available" && pick(after).availability === "available";
  const whole = (overview: BoardOverview) => overview.roadmap.availability === "available" && overview.roadmap.phases.length > 0 && !overview.warnings.includes("roadmap-malformed") && !overview.warnings.includes("roadmap-limited");
  const phased = whole(before) && whole(after);
  if (readable((overview) => overview.state)) {
    if (after.state.phaseId && before.state.phaseId !== after.state.phaseId) summary.push(`phase ${after.state.phaseId}`);
  }
  if (phased) {
    const completed = new Set(before.roadmap.phases.filter((phase) => phase.completed).map((phase) => phase.id));
    for (const phase of after.roadmap.phases) if (phase.completed && !completed.has(phase.id)) summary.push(`phase ${phase.id} complete`);
  }
  if (phased && readable((overview) => overview.plans)) {
    const plans = new Map(before.plans.phases.flatMap((phase) => phase.entries).map((plan) => [plan.id, plan]));
    for (const plan of after.plans.phases.flatMap((phase) => phase.entries)) {
      const prior = plans.get(plan.id);
      if (!prior) { tasks.push(plan.id); summary.push(`plan ${plan.id} added`); }
      else if (plan.summaryObserved && !prior.summaryObserved) { tasks.push(plan.id); summary.push(`plan ${plan.id} summary written`); }
    }
  }
  if (phased && readable((overview) => overview.uat)) {
    // The phase result counts cover every test; the listed tests are trimmed to a budget.
    const results = (overview: BoardOverview, kind: "pass" | "issue") => overview.uat.phases.reduce((sum, phase) => sum + (phase.observation === "observed" ? phase.results[kind] : 0), 0);
    const passed = results(after, "pass") - results(before, "pass");
    const issues = results(after, "issue") - results(before, "issue");
    if (passed > 0) summary.push(`${count(passed, "UAT test")} passed`);
    if (issues > 0) summary.push(`${count(issues, "new UAT issue")}`);
  }
  if (phased && readable((overview) => overview.verification)) {
    const verified = new Map(before.verification.phases.map((phase) => [phase.id, phase.statusKind]));
    for (const phase of after.verification.phases) if (phase.statusKind && verified.get(phase.id) !== phase.statusKind) summary.push(`phase ${phase.id} verification ${words(phase.statusKind.replace(/_/g, "-"))}`);
  }
  if (readable((overview) => overview.debug)) {
    const sessions = after.debug.sessions.length - before.debug.sessions.length;
    if (sessions > 0) summary.push(`${count(sessions, "new debug session")}`);
  }
  if (readable((overview) => overview.todos)) {
    const todos = after.todos.counts.pending - before.todos.counts.pending;
    if (todos > 0) summary.push(`${count(todos, "new pending TODO")}`);
  }
  if (readable((overview) => overview.state) && after.state.lastActivity && after.state.lastActivity !== before.state.lastActivity) summary.push("new activity");
  return { tasks, summary };
}

/** What changed between two snapshots of one workspace, for the banner and the highlights; null for a first read or no change. */
export function snapshotChanges(previous: BoardSnapshot | null, next: BoardSnapshot, at: number): BoardChanges | null {
  if (!previous || previous.workspaceId !== next.workspaceId) return null;
  const found = previous.path && next.path ? pathChanges(previous, next) : previous.overview && next.overview ? coreChanges(previous.overview, next.overview) : null;
  return found && found.summary.length ? { at, ...found } : null;
}
