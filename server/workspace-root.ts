import { lstat, realpath } from "node:fs/promises";
import { join, relative } from "node:path";

export type RootWarning = "absent" | "containment-refused" | "unreadable" | "unsupported";

export type WorkspaceRoot =
  | { available: true; root: string; planningRoot: string }
  | { available: false; warning: RootWarning };

export const isStrictDescendant = (root: string, candidate: string) => {
  const value = relative(root, candidate);
  return value !== "" && value !== ".." && !value.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`);
};

export async function resolveWorkspaceRoot(directory: string): Promise<WorkspaceRoot> {
  try {
    const root = await realpath(directory);
    const rootStat = await lstat(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return { available: false, warning: "containment-refused" };

    const planningTextualPath = join(root, ".planning");
    const planningBefore = await lstat(planningTextualPath).catch(() => null);
    if (!planningBefore) return { available: false, warning: "absent" };
    if (!planningBefore.isDirectory() || planningBefore.isSymbolicLink()) return { available: false, warning: "containment-refused" };

    const planningRoot = await realpath(planningTextualPath);
    if (!isStrictDescendant(root, planningRoot)) return { available: false, warning: "containment-refused" };
    const planningAfter = await lstat(planningRoot);
    if (!planningAfter.isDirectory() || planningAfter.isSymbolicLink() || planningBefore.dev !== planningAfter.dev || planningBefore.ino !== planningAfter.ino) {
      return { available: false, warning: "containment-refused" };
    }
    return { available: true, root, planningRoot };
  } catch {
    return { available: false, warning: "unreadable" };
  }
}
