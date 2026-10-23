import type { BoardSnapshot } from "../shared/board-rpc.js";

/** What an automatic refresh found changed: the tasks to highlight and a few words for the banner and screen readers. */
export type BoardChanges = { at: number; tasks: string[]; summary: string[] };
/** `statusFailed`: the last status poll got no answer, so the board cannot tell whether the files changed. */
export type BoardReadingState = { workspaceId: string; snapshot: BoardSnapshot | null; busy: boolean; error: string | null; refreshAnnouncement: string | null; changes: BoardChanges | null; statusFailed: boolean };
export const createBoardState = (workspaceId: string): BoardReadingState => ({ workspaceId, snapshot: null, busy: false, error: null, refreshAnnouncement: null, changes: null, statusFailed: false });

const words = (token: string | null) => token ? token.replace(/-/g, " ") : "not recorded";
const allTasks = (snapshot: BoardSnapshot) => snapshot.path ? [...snapshot.path.tasks.waves.flatMap((wave) => wave.tasks), ...snapshot.path.tasks.unassigned] : [];

/** "T014 done", "phase build", "wave 2 review cycle 1 blocked", "new log entry": what changed between two GSD Path snapshots. */
export function snapshotChanges(previous: BoardSnapshot | null, next: BoardSnapshot, at: number): BoardChanges | null {
  const before = previous?.path;
  const after = next.path;
  if (!before || !after || previous.workspaceId !== next.workspaceId) return null;
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
  if (after.questions.counts.pending > before.questions.counts.pending) summary.push(`${after.questions.counts.pending - before.questions.counts.pending} new question${after.questions.counts.pending - before.questions.counts.pending === 1 ? "" : "s"}`);
  const event = (path: typeof after) => path.state.lastEvent ? `${path.state.lastEvent.date}|${path.state.lastEvent.text ?? ""}` : null;
  if (event(after) && event(after) !== event(before)) summary.push("new log entry");
  return summary.length ? { at, tasks, summary } : null;
}
