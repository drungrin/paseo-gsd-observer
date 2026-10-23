import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { join, relative } from "node:path";

export type RootWarning = "absent" | "containment-refused" | "unreadable" | "unsupported";
/** GSD Core keeps its evidence in `.planning/`; GSD Path, upstream or a fork, in `.project/`. */
export type Flavor = "gsd-core" | "gsd-path";

/** `planningRoot` is the flavor's evidence directory. A GSD Path install that has not started may not have created it yet. */
export type WorkspaceRoot =
  | { available: true; flavor: Flavor; root: string; planningRoot: string }
  | { available: false; warning: RootWarning };

const MARKER_BYTES = 16 * 1024;
// Presence alone marks a GSD Path install: these files are never read.
const PATH_INSTALL_FILES = [[".gsd-path", "runtime.json"], [".gsd-path", "status_runtime.py"], [".gsd-path", "runtime", "pipeline_state.py"]] as const;

export const isStrictDescendant = (root: string, candidate: string) => {
  const value = relative(root, candidate);
  return value !== "" && value !== ".." && !value.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`);
};

/** A real directory directly inside the root, not a link, and unchanged while it was resolved. */
async function containedDirectory(root: string, name: string): Promise<{ path: string } | "absent" | "refused"> {
  const textual = join(root, name);
  const before = await lstat(textual).catch(() => null);
  if (!before) return "absent";
  if (!before.isDirectory() || before.isSymbolicLink()) return "refused";
  const canonical = await realpath(textual);
  if (!isStrictDescendant(root, canonical)) return "refused";
  const after = await lstat(canonical);
  if (!after.isDirectory() || after.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino) return "refused";
  return { path: canonical };
}

const isPathInstall = async (root: string) => {
  for (const parts of PATH_INSTALL_FILES) if ((await lstat(join(root, ...parts)).catch(() => null))?.isFile()) return true;
  return false;
};

/** The `pipeline:` value in the frontmatter of a regular `.project/STATE.md`, read from its first bytes without following links. */
async function pipelineMarker(projectRoot: string): Promise<string | null | "refused"> {
  const file = join(projectRoot, "STATE.md");
  const before = await lstat(file).catch(() => null);
  if (!before) return null;
  if (!before.isFile() || before.isSymbolicLink()) return "refused";
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const buffer = Buffer.alloc(MARKER_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, MARKER_BYTES, 0);
    const lines = buffer.subarray(0, bytesRead).toString("utf8").replace(/^﻿/, "").split(/\r?\n/);
    if (lines[0]?.trim() !== "---") return null;
    for (const line of lines.slice(1)) {
      if (line.trim() === "---") return null;
      const value = /^pipeline:\s*([^\s#]+)/.exec(line)?.[1];
      if (value) return value;
    }
    return null;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/**
 * GSD Path governs a workspace whose `.project/STATE.md` names a `gsd-path/` pipeline, or that has a GSD Path install with no
 * milestone yet. A migrated project keeps `.planning/` only as GSD Core history, so GSD Path wins when both are present. A
 * `.project` file (Eclipse uses one) is not GSD Path.
 */
async function pathRoot(root: string): Promise<{ planningRoot: string } | "refused" | null> {
  const project = await containedDirectory(root, ".project");
  if (project === "refused") return (await lstat(join(root, ".project")))?.isFile() ? null : "refused";
  if (project === "absent") return await isPathInstall(root) ? { planningRoot: join(root, ".project") } : null;
  const marker = await pipelineMarker(project.path);
  if (marker === "refused") return "refused";
  return marker?.startsWith("gsd-path/") || (!marker && await isPathInstall(root)) ? { planningRoot: project.path } : null;
}

export async function resolveWorkspaceRoot(directory: string): Promise<WorkspaceRoot> {
  try {
    const root = await realpath(directory);
    const rootStat = await lstat(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return { available: false, warning: "containment-refused" };

    const path = await pathRoot(root);
    if (path && path !== "refused") return { available: true, flavor: "gsd-path", root, planningRoot: path.planningRoot };

    // A `.project` that cannot be inspected safely is never followed; GSD Core evidence is still read when present.
    const planning = await containedDirectory(root, ".planning");
    if (planning === "absent") return { available: false, warning: path === "refused" ? "containment-refused" : "absent" };
    if (planning === "refused") return { available: false, warning: "containment-refused" };
    return { available: true, flavor: "gsd-core", root, planningRoot: planning.path };
  } catch {
    return { available: false, warning: "unreadable" };
  }
}
