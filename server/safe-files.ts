import { constants, type Stats } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { dirname } from "node:path";
import { isStrictDescendant } from "./workspace-root.js";

/** Filesystem primitives shared by the GSD Core and GSD Path readers: no links, no escapes, no files that change while read. */

export type SafeReadWarning = "absent" | "oversize" | "containment-refused" | "unreadable" | "limit-reached" | "inconsistent";

export const FILE_BYTES = 256 * 1024;
export const SNAPSHOT_BYTES = 32 * 1024 * 1024;
export const DIRECTORY_ENTRIES = 2048;
export const TIMEOUT_MS = 10_000;

export const withTimeout = async <T>(work: Promise<T>, timeoutMs: number = TIMEOUT_MS): Promise<T> => new Promise<T>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("timed out")), timeoutMs);
  void work.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
});
const isMissing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === "ENOENT";
async function safeStat(path: string): Promise<{ stat?: Stats; warning?: SafeReadWarning }> {
  try { return { stat: await lstat(path) }; }
  catch (error) { return { warning: isMissing(error) ? "absent" : "unreadable" }; }
}

export async function readSafeFile(evidenceRoot: string, file: string, maxBytes: number = FILE_BYTES): Promise<{ bytes?: Uint8Array; warning?: SafeReadWarning }> {
  const parent = dirname(file);
  const parentResult = await safeStat(parent);
  if (!parentResult.stat) return { warning: parentResult.warning };
  const parentBefore = parentResult.stat;
  if (!parentBefore.isDirectory() || parentBefore.isSymbolicLink()) return { warning: "containment-refused" };
  const beforeResult = await safeStat(file);
  if (!beforeResult.stat) return { warning: beforeResult.warning };
  const before = beforeResult.stat;
  if (!before.isFile() || before.isSymbolicLink()) return { warning: "containment-refused" };
  if (before.size > maxBytes) return { warning: "oversize" };
  let canonical: string;
  try { canonical = await realpath(file); }
  catch (error) { return { warning: isMissing(error) ? "inconsistent" : "unreadable" }; }
  if (!isStrictDescendant(evidenceRoot, canonical)) return { warning: "containment-refused" };
  let handle;
  try {
    // A FIFO swapped in after the check must not block the read.
    handle = await open(canonical, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const descriptor = await handle.stat();
    if (!descriptor.isFile() || descriptor.dev !== before.dev || descriptor.ino !== before.ino || descriptor.size !== before.size) return { warning: "inconsistent" };
    const buffer = Buffer.alloc(Math.min(descriptor.size, maxBytes) + 1);
    const result = await handle.read(buffer, 0, buffer.length, 0);
    const after = await handle.stat();
    const parentAfter = await safeStat(parent);
    if (parentAfter.warning === "unreadable") return { warning: "unreadable" };
    if (!parentAfter.stat || parentAfter.stat.dev !== parentBefore.dev || parentAfter.stat.ino !== parentBefore.ino || result.bytesRead > maxBytes || after.size > maxBytes) return { warning: result.bytesRead > maxBytes || after.size > maxBytes ? "oversize" : "inconsistent" };
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size) return { warning: "inconsistent" };
    return { bytes: buffer.subarray(0, result.bytesRead) };
  } catch {
    return { warning: "unreadable" };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function listDirectory(path: string, maxEntries: number = DIRECTORY_ENTRIES): Promise<{ entries: string[]; warning?: SafeReadWarning }> {
  const entries: string[] = [];
  let directory;
  try {
    directory = await opendir(path);
    for await (const entry of directory) {
      entries.push(entry.name);
      if (entries.length > maxEntries) return { entries, warning: "limit-reached" };
    }
    return { entries };
  } catch {
    return { entries, warning: "unreadable" };
  } finally {
    await directory?.close().catch(() => undefined);
  }
}

export async function validateSafeDirectory(evidenceRoot: string, path: string): Promise<SafeReadWarning | undefined> {
  const result = await safeStat(path);
  if (!result.stat) return result.warning;
  if (!result.stat.isDirectory() || result.stat.isSymbolicLink()) return "containment-refused";
  let canonical: string;
  try { canonical = await realpath(path); }
  catch (error) { return isMissing(error) ? "inconsistent" : "unreadable"; }
  return isStrictDescendant(evidenceRoot, canonical) ? undefined : "containment-refused";
}
