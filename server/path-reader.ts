import { lstat } from "node:fs/promises";
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
const REVIEW_FILES = 256;
// Reviews a build recovery set aside are history: they get their own budget, so they never starve current evidence.
const RECOVERIES = 32;
const RECOVERY_FILES = 128;
const RECOVERY_BYTES = 8 * 1024 * 1024;
// The runtime's own task file rule, with the id capped at the length the board accepts.
export const PATH_TASK_FILE = /^T\d{3,6}-[a-z0-9][a-z0-9-]*\.md$/;
export const PATH_REVIEW_FILE = /^(?=.{1,200}$)[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*\.md$/;
export const PATH_RECOVERY_DIRECTORY = /^build-recovery-[0-9a-f]{40}$/;
// The runtime's archive folder rule: `.project/archive/<NNN>-<slug>/`, written once at ship.
export const PATH_ARCHIVE_DIRECTORY = /^\d{3,6}-[a-z0-9][a-z0-9-]{0,127}$/;
const ARCHIVES = 128;
export const PATH_DOCUMENTS: readonly (readonly [string, PathArtifactKind])[] = [["STATE.md", "path-state"], ["ROADMAP.md", "path-roadmap"], ["plan/PLAN.md", "path-plan"], ["next/STATE.md", "path-next-state"], ["discuss/ANSWERS.md", "path-answers"]];
export const PATH_DIRECTORIES = ["plan", "next", "tasks", "review", "discuss", "archive"] as const;
const directoryKind: Record<typeof PATH_DIRECTORIES[number], PathArtifactKind> = { plan: "path-plan", next: "path-next-state", tasks: "path-task", review: "path-review", discuss: "path-answers", archive: "path-manifest" };

/** Whether a `.project/`-relative path is an allowlisted document or a folder that holds them; the watcher ignores everything else. */
export function isPathEvidence(relative: string): boolean {
  const parts = relative.split("/");
  const folders: readonly string[] = PATH_DIRECTORIES;
  if (parts.length === 1) return folders.includes(parts[0]) || PATH_DOCUMENTS.some(([key]) => key === parts[0]);
  if (parts.length === 2 && parts[0] === "tasks") return PATH_TASK_FILE.test(parts[1]);
  if (parts.length === 2 && parts[0] === "review") return PATH_REVIEW_FILE.test(parts[1]);
  if (parts.length === 2 && parts[0] === "plan" && PATH_RECOVERY_DIRECTORY.test(parts[1])) return true;
  if (parts[0] === "archive") return PATH_ARCHIVE_DIRECTORY.test(parts[1]) && (parts.length === 2 || (parts.length === 3 && parts[2] === "MANIFEST.md"));
  if (parts.length === 2) return PATH_DOCUMENTS.some(([key]) => key === relative);
  if (parts[0] !== "plan" || !PATH_RECOVERY_DIRECTORY.test(parts[1]) || parts[2] !== "review") return false;
  return parts.length === 3 || (parts.length === 4 && PATH_REVIEW_FILE.test(parts[3]));
}

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
  let recoveryBytes = 0;
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
    const recovery = kind === "path-recovery-review";
    if (totalBytes + result.bytes.byteLength > SNAPSHOT_BYTES || (recovery && recoveryBytes + result.bytes.byteLength > RECOVERY_BYTES)) return problem(kind, "observation-limited");
    totalBytes += result.bytes.byteLength;
    if (recovery) recoveryBytes += result.bytes.byteLength;
    artifacts.push({ key, kind, bytes: result.bytes, size: result.bytes.byteLength });
  };
  /** The allowlisted files of one validated folder, in name order, up to its cap. */
  const readFolder = async (folder: string, pattern: RegExp, kind: PathArtifactKind, cap: number) => {
    const listing = await listDirectory(join(projectRoot, folder));
    if (listing.warning) problem(kind, listing.warning);
    const files = listing.entries.filter((name) => pattern.test(name)).sort();
    if (files.length > cap) problem(kind, "limit-reached");
    for (const name of files.slice(0, cap)) await read(join(folder, name), kind);
  };
  const safeFolder = async (folder: string, kind: PathArtifactKind) => {
    const warning = await validateSafeDirectory(projectRoot, join(projectRoot, folder));
    if (warning && warning !== "absent") problem(kind, warning);
    if (!warning) watchDirectories.push(folder);
    return !warning;
  };

  for (const [key, kind] of PATH_DOCUMENTS) await read(key, kind, kind === "path-state" ? STATE_BYTES : FILE_BYTES);
  for (const directory of PATH_DIRECTORIES) await safeFolder(directory, directoryKind[directory]);
  if (watchDirectories.includes("tasks")) await readFolder("tasks", PATH_TASK_FILE, "path-task", TASK_FILES);
  if (watchDirectories.includes("review")) await readFolder("review", PATH_REVIEW_FILE, "path-review", REVIEW_FILES);
  if (watchDirectories.includes("archive")) {
    // Only each shipped milestone's manifest is read; the archived evidence itself stays history.
    const listing = await listDirectory(join(projectRoot, "archive"));
    if (listing.warning) problem("path-manifest", listing.warning);
    const archives = listing.entries.filter((name) => PATH_ARCHIVE_DIRECTORY.test(name)).sort();
    if (archives.length > ARCHIVES) problem("path-manifest", "limit-reached");
    for (const name of archives.slice(0, ARCHIVES)) {
      const warning = await validateSafeDirectory(projectRoot, join(projectRoot, "archive", name));
      if (warning) { if (warning !== "absent") problem("path-manifest", warning); continue; }
      await read(join("archive", name, "MANIFEST.md"), "path-manifest");
    }
  }
  if (watchDirectories.includes("plan")) {
    const listing = await listDirectory(join(projectRoot, "plan"));
    if (listing.warning) problem("path-recovery-review", listing.warning);
    // Folder names are hashes, so the cap and budget keep the most recently changed recoveries and drop the oldest.
    const named = listing.entries.filter((name) => PATH_RECOVERY_DIRECTORY.test(name));
    const changed = new Map(await Promise.all(named.map(async (name) => [name, (await lstat(join(projectRoot, "plan", name)).catch(() => null))?.mtimeMs ?? 0] as const)));
    const recoveries = named.sort((left, right) => (changed.get(right) ?? 0) - (changed.get(left) ?? 0) || left.localeCompare(right));
    if (recoveries.length > RECOVERIES) problem("path-recovery-review", "limit-reached");
    for (const name of recoveries.slice(0, RECOVERIES)) {
      const folder = join("plan", name);
      if (await safeFolder(folder, "path-recovery-review") && await safeFolder(join(folder, "review"), "path-recovery-review")) await readFolder(join(folder, "review"), PATH_REVIEW_FILE, "path-recovery-review", RECOVERY_FILES);
    }
  }
  return { available: true, flavor: "gsd-path", root, planningRoot: projectRoot, watchDirectories, artifacts, problems, warnings: [...new Set(warnings)], limited };
}
