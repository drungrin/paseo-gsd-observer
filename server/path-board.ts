import { BoardPathSchema, PATH_WARNINGS, type BoardPath, type PathWarning } from "../shared/path.js";
import type { AllowedInventory } from "./allowed-reader.js";
import { buildNext, buildRoadmap, buildState, buildTimeline, emptyRoadmap, emptyState, emptyTimeline, logEntries, readState } from "./path-overview.js";
import { buildQuestions, emptyQuestions } from "./path-questions.js";
import { buildReviews, emptyReviews } from "./path-reviews.js";
import { buildTasks, emptyTasks } from "./path-tasks.js";

const ordered = (warnings: ReadonlySet<PathWarning>) => PATH_WARNINGS.filter((warning) => warnings.has(warning));

const unparsed = (setup: BoardPath["setup"], warnings: ReadonlySet<PathWarning> = new Set()): BoardPath => ({
  setup, state: emptyState(), timeline: emptyTimeline(), roadmap: emptyRoadmap(setup === "not-started" ? "absent" : "unavailable"),
  next: null, tasks: emptyTasks(setup === "not-started" ? "absent" : "unavailable"),
  reviews: emptyReviews(setup === "not-started" ? "absent" : "unavailable"), questions: emptyQuestions(setup === "not-started" ? "absent" : "unavailable"),
  warnings: ordered(warnings),
});

/** Every GSD Path projection the tabs read, from one allowlisted inventory. */
export function buildPath(inventory: AllowedInventory): BoardPath {
  const warnings = new Set<PathWarning>();
  const reading = readState(inventory, warnings);
  if (reading.setup !== "started") return unparsed(reading.setup);
  const entries = logEntries(reading.body, warnings);
  const state = buildState(reading, entries);
  const board: BoardPath = {
    setup: "started",
    state,
    timeline: buildTimeline(entries, state.phase),
    roadmap: buildRoadmap(inventory, state.milestone, warnings),
    next: buildNext(inventory, warnings),
    tasks: buildTasks(inventory, warnings),
    reviews: buildReviews(inventory, entries, warnings),
    questions: buildQuestions(inventory, warnings),
    warnings: [],
  };
  if (inventory.limited) warnings.add("evidence-limited");
  board.warnings = ordered(warnings);
  return BoardPathSchema.safeParse(board).success ? board : unparsed("started", new Set([...warnings, "state-malformed"]));
}
