import { join } from "node:path";
import type { AllowedArtifact, AllowedInventory, InventoryProblem, InventoryWarning, PathArtifactKind } from "./allowed-reader.js";
import { FILE_BYTES, listDirectory, readSafeFile, SNAPSHOT_BYTES, validateSafeDirectory } from "./safe-files.js";

/**
 * The GSD Path allowlist under `.project/`. Logs, ledgers, research, archives and anything outside `.project/` are never read:
 * the verify ledger holds commands and their output, and the runtime's route and completion need Git and code execution.
 */

// The STATE.md log grows with every transition; its frontmatter is still the first thing in the file.
const STATE_BYTES = 1024 * 1024;
const TASK_FILES = 512;
// The runtime's own task file rule, with the id capped at the length the board accepts.
export const PATH_TASK_FILE = /^T\d{3,6}-[a-z0-9][a-z0-9-]*\.md$/;
export const PATH_DOCUMENTS: readonly (readonly [string, PathArtifactKind])[] = [["STATE.md", "path-state"], ["ROADMAP.md", "path-roadmap"], ["plan/PLAN.md", "path-plan"], ["next/STATE.md", "path-next-state"]];
export const PATH_DIRECTORIES = ["plan", "next", "tasks"] as const;

export async function readPathInventory(root: string, projectRoot: string): Promise<AllowedInventory> {
  const projectWarning = await validateSafeDirectory(root, projectRoot);
  // An install with no milestone has no `.project/` yet: there is nothing to read or watch.
  if (projectWarning === "absent") return { available: true, flavor: "gsd-path", root, artifacts: [], problems: [{ kind: "path-state", warning: "absent" }], warnings: [], limited: false };
  if (projectWarning) return { available: false, flavor: "gsd-path", artifacts: [], problems: [], warnings: [projectWarning], limited: false };
  const artifacts: AllowedArtifact[] = [];
  const problems: InventoryProblem[] = [];
  const warnings: InventoryWarning[] = [];
  const watchDirectories: string[] = [];
  let limited = false;
  let totalBytes = 0;
  const problem = (kind: PathArtifactKind, warning: InventoryWarning) => {
    problems.push({ kind, warning });
    // Only the state document decides whether the workspace can be shown; every other document is optional evidence.
    if (kind === "path-state" && warning !== "absent") warnings.push(warning);
    if (warning === "limit-reached" || warning === "observation-limited") limited = true;
  };
  const read = async (key: string, kind: PathArtifactKind, maxBytes = FILE_BYTES) => {
    const result = await readSafeFile(projectRoot, join(projectRoot, key), maxBytes);
    if (!result.bytes) {
      if (result.warning !== "absent" || kind === "path-state") problem(kind, result.warning ?? "unreadable");
      return;
    }
    if (totalBytes + result.bytes.byteLength > SNAPSHOT_BYTES) return problem(kind, "observation-limited");
    totalBytes += result.bytes.byteLength;
    artifacts.push({ key, kind, bytes: result.bytes, size: result.bytes.byteLength });
  };

  for (const [key, kind] of PATH_DOCUMENTS) await read(key, kind, kind === "path-state" ? STATE_BYTES : FILE_BYTES);
  for (const directory of PATH_DIRECTORIES) {
    const path = join(projectRoot, directory);
    const warning = await validateSafeDirectory(projectRoot, path);
    if (warning === "absent") continue;
    if (warning) { problem(directory === "tasks" ? "path-task" : directory === "plan" ? "path-plan" : "path-next-state", warning); continue; }
    watchDirectories.push(directory);
  }
  if (watchDirectories.includes("tasks")) {
    const listing = await listDirectory(join(projectRoot, "tasks"));
    if (listing.warning) problem("path-task", listing.warning);
    const files = listing.entries.filter((name) => PATH_TASK_FILE.test(name)).sort();
    if (files.length > TASK_FILES) problem("path-task", "limit-reached");
    for (const name of files.slice(0, TASK_FILES)) await read(join("tasks", name), "path-task");
  }
  return { available: true, flavor: "gsd-path", root, planningRoot: projectRoot, watchDirectories, artifacts, problems, warnings: [...new Set(warnings)], limited };
}
