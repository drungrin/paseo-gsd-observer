import { constants } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { isStrictDescendant, resolveWorkspaceRoot } from "./workspace-root.js";

export const LIMITS = {
  bytesPerFile: 256 * 1024,
  bytesPerSnapshot: 8 * 1024 * 1024,
  directoryEntries: 2048,
  artifacts: 512,
  milestones: 32,
  phases: 256,
  plansPerPhase: 128,
  titleLength: 200,
  identifierLength: 64,
  warningsPerItem: 16,
  timeoutMs: 10_000,
} as const;

export type InventoryWarning = "absent" | "oversize" | "malformed" | "truncated" | "unsupported" | "containment-refused" | "unreadable" | "limit-reached" | "observation-limited" | "inconsistent";
export type ArtifactKind = "roadmap" | "state" | "milestones" | "context" | "plan" | "summary" | "verification" | "uat" | "review";
export type AllowedArtifact = { key: string; kind: ArtifactKind; phaseId?: string; milestoneId?: string; bytes: Uint8Array; size: number };
export type InventoryProblem = { phaseId?: string; milestoneId?: string; warning: InventoryWarning };
export type AllowedInventory = { available: boolean; root?: string; planningRoot?: string; archiveIds?: string[]; artifacts: AllowedArtifact[]; problems: InventoryProblem[]; warnings: InventoryWarning[]; limited: boolean };

const phaseIdPattern = "\\d+(?:\\.\\d+)*";
const phaseDirPattern = new RegExp(`^(${phaseIdPattern})-([A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)$`);
const archiveVersionPattern = /^[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*$/;
const reservedName = /^(?:\.|\.\.|con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const phaseFilePattern = /^(?:(\d+(?:\.\d+)*(?:-\d+)?)-)?(CONTEXT|PLAN|SUMMARY|VERIFICATION|UAT|REVIEW|REVIEWS)\.md$/i;

const isSafeSegment = (value: string) => value.length > 0 && value.length <= LIMITS.identifierLength && !reservedName.test(value) && !/[\\/\0\r\n]/.test(value);
const canonicalPhaseId = (value: string) => value.split(".").map((part) => part.replace(/^0+(?=\d)/, "")).join(".");
const warningList = (values: readonly InventoryWarning[]) => [...new Set(values)].slice(0, LIMITS.warningsPerItem);
const withTimeout = async <T>(work: Promise<T>): Promise<T> => new Promise<T>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("timed out")), LIMITS.timeoutMs);
  void work.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
});

async function readSafeFile(planningRoot: string, file: string): Promise<{ bytes?: Uint8Array; warning?: InventoryWarning }> {
  const parent = dirname(file);
  const parentBefore = await lstat(parent).catch(() => null);
  const before = await lstat(file).catch(() => null);
  if (!parentBefore || !before) return { warning: "absent" };
  if (!parentBefore.isDirectory() || parentBefore.isSymbolicLink() || !before.isFile() || before.isSymbolicLink()) return { warning: "containment-refused" };
  if (before.size > LIMITS.bytesPerFile) return { warning: "oversize" };
  const canonical = await realpath(file).catch(() => null);
  if (!canonical || !isStrictDescendant(planningRoot, canonical)) return { warning: "containment-refused" };
  let handle;
  try {
    handle = await open(canonical, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const descriptor = await handle.stat();
    if (!descriptor.isFile() || descriptor.dev !== before.dev || descriptor.ino !== before.ino || descriptor.size !== before.size) return { warning: "inconsistent" };
    const buffer = Buffer.alloc(Math.min(descriptor.size, LIMITS.bytesPerFile) + 1);
    const result = await handle.read(buffer, 0, buffer.length, 0);
    const after = await handle.stat();
    const parentAfter = await lstat(parent).catch(() => null);
    if (!parentAfter || parentAfter.dev !== parentBefore.dev || parentAfter.ino !== parentBefore.ino || result.bytesRead > LIMITS.bytesPerFile || after.size > LIMITS.bytesPerFile) return { warning: result.bytesRead > LIMITS.bytesPerFile || after.size > LIMITS.bytesPerFile ? "oversize" : "inconsistent" };
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size) return { warning: "inconsistent" };
    return { bytes: buffer.subarray(0, result.bytesRead) };
  } catch {
    return { warning: "unreadable" };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function listDirectory(path: string): Promise<{ entries: string[]; warning?: InventoryWarning }> {
  const entries: string[] = [];
  let directory;
  try {
    directory = await opendir(path);
    for await (const entry of directory) {
      entries.push(entry.name);
      if (entries.length > LIMITS.directoryEntries) return { entries, warning: "limit-reached" };
    }
    return { entries };
  } catch {
    return { entries, warning: "unreadable" };
  } finally {
    await directory?.close().catch(() => undefined);
  }
}

async function validateSafeDirectory(planningRoot: string, path: string): Promise<InventoryWarning | undefined> {
  const stat = await lstat(path).catch(() => null);
  if (!stat) return "absent";
  if (!stat.isDirectory() || stat.isSymbolicLink()) return "containment-refused";
  const canonical = await realpath(path).catch(() => null);
  return canonical && isStrictDescendant(planningRoot, canonical) ? undefined : "containment-refused";
}

function kindForPhaseFile(name: string): ArtifactKind | null {
  const match = phaseFilePattern.exec(name);
  if (!match) return null;
  return match[2].toLowerCase() as ArtifactKind;
}

export type InventoryReadOptions = { archiveMilestoneId?: string; includeArchives?: boolean };

export async function readAllowedInventory(directory: string, options: InventoryReadOptions = {}): Promise<AllowedInventory> {
  try {
    return await withTimeout(readInventory(directory, options));
  } catch {
    return { available: false, artifacts: [], problems: [], warnings: ["unreadable"], limited: false };
  }
}

async function readInventory(directory: string, options: InventoryReadOptions): Promise<AllowedInventory> {
  const root = await resolveWorkspaceRoot(directory);
  if (!root.available) return { available: false, artifacts: [], problems: [], warnings: [root.warning], limited: false };
  const artifacts: AllowedArtifact[] = [];
  const problems: InventoryProblem[] = [];
  const warnings: InventoryWarning[] = [];
  let limited = false;
  let totalBytes = 0;
  const recordProblem = (warning: InventoryWarning, scope: Omit<InventoryProblem, "warning"> = {}) => {
    problems.push({ ...scope, warning });
    warnings.push(warning);
    if (warning === "limit-reached" || warning === "observation-limited") limited = true;
  };
  const add = async (key: string, kind: ArtifactKind, scope: Omit<AllowedArtifact, "key" | "kind" | "bytes" | "size"> = {}) => {
    if (artifacts.length >= LIMITS.artifacts) return recordProblem("limit-reached", scope);
    const result = await readSafeFile(root.planningRoot, join(root.planningRoot, key));
    if (!result.bytes) return recordProblem(result.warning ?? "unreadable", scope);
    if (totalBytes + result.bytes.byteLength > LIMITS.bytesPerSnapshot) return recordProblem("observation-limited", scope);
    totalBytes += result.bytes.byteLength;
    artifacts.push({ key, kind, ...scope, bytes: result.bytes, size: result.bytes.byteLength });
  };

  for (const [name, kind] of [["ROADMAP.md", "roadmap"], ["STATE.md", "state"], ["MILESTONES.md", "milestones"]] as const) await add(name, kind);

  const phasesRoot = join(root.planningRoot, "phases");
  const phasesRootWarning = await validateSafeDirectory(root.planningRoot, phasesRoot);
  const phases = phasesRootWarning ? { entries: [], warning: phasesRootWarning } : await listDirectory(phasesRoot);
  if (phases.warning) recordProblem(phases.warning);
  let phaseCount = 0;
  for (const entry of phases.entries) {
    const match = phaseDirPattern.exec(entry);
    if (!match || !isSafeSegment(match[1]) || !isSafeSegment(match[2])) continue;
    if (++phaseCount > LIMITS.phases) { recordProblem("limit-reached"); break; }
    const phaseId = canonicalPhaseId(match[1]);
    const phasePath = join(root.planningRoot, "phases", entry);
    const phaseWarning = await validateSafeDirectory(root.planningRoot, phasePath);
    if (phaseWarning) { recordProblem(phaseWarning === "absent" ? "containment-refused" : phaseWarning, { phaseId }); continue; }
    const files = await listDirectory(phasePath);
    if (files.warning) recordProblem(files.warning, { phaseId });
    let plans = 0;
    for (const file of files.entries) {
      const kind = kindForPhaseFile(file);
      if (!kind) continue;
      if (kind === "plan" && ++plans > LIMITS.plansPerPhase) { recordProblem("limit-reached", { phaseId }); break; }
      await add(join("phases", entry, file), kind, { phaseId });
    }
  }

  const milestonesRoot = join(root.planningRoot, "milestones");
  const milestonesRootWarning = await validateSafeDirectory(root.planningRoot, milestonesRoot);
  const milestones = milestonesRootWarning ? { entries: [], warning: milestonesRootWarning } : await listDirectory(milestonesRoot);
  if (milestones.warning) recordProblem(milestones.warning);
  const archiveIds = [...new Set(milestones.entries.flatMap((entry) => {
    const archive = /^(.+)-ROADMAP\.md$/i.exec(entry);
    const phaseArchive = /^(.+)-phases$/i.exec(entry);
    const milestoneId = archive?.[1] ?? phaseArchive?.[1];
    return milestoneId && archiveVersionPattern.test(milestoneId) && isSafeSegment(milestoneId) ? [milestoneId] : [];
  }))].sort((left, right) => left.localeCompare(right)).slice(0, LIMITS.milestones);
  if (options.includeArchives === false) return { available: true, root: root.root, planningRoot: root.planningRoot, archiveIds, artifacts, problems, warnings: warningList(warnings), limited };
  const milestoneVersions = new Set<string>();
  for (const entry of milestones.entries) {
    const archive = /^(.+)-ROADMAP\.md$/i.exec(entry);
    const phaseArchive = /^(.+)-phases$/i.exec(entry);
    const milestoneId = archive?.[1] ?? phaseArchive?.[1];
    if (!milestoneId || !archiveVersionPattern.test(milestoneId) || !isSafeSegment(milestoneId)) continue;
    if (options.archiveMilestoneId && milestoneId !== options.archiveMilestoneId) continue;
    if (!milestoneVersions.has(milestoneId)) {
      milestoneVersions.add(milestoneId);
      if (milestoneVersions.size > LIMITS.milestones) { recordProblem("limit-reached"); break; }
    }
    if (archive) { await add(join("milestones", entry), "roadmap", { milestoneId }); continue; }
    const archiveRoot = join(root.planningRoot, "milestones", entry);
    const archiveWarning = await validateSafeDirectory(root.planningRoot, archiveRoot);
    if (archiveWarning) { recordProblem(archiveWarning === "absent" ? "containment-refused" : archiveWarning, { milestoneId }); continue; }
    const archivePhases = await listDirectory(archiveRoot);
    if (archivePhases.warning) recordProblem(archivePhases.warning, { milestoneId });
    for (const phaseEntry of archivePhases.entries) {
      const match = phaseDirPattern.exec(phaseEntry);
      if (!match || !isSafeSegment(match[1]) || !isSafeSegment(match[2])) continue;
      const phaseId = canonicalPhaseId(match[1]);
      const phaseRoot = join(archiveRoot, phaseEntry);
      const phaseWarning = await validateSafeDirectory(root.planningRoot, phaseRoot);
      if (phaseWarning) { recordProblem(phaseWarning === "absent" ? "containment-refused" : phaseWarning, { milestoneId, phaseId }); continue; }
      const archiveFiles = await listDirectory(phaseRoot);
      if (archiveFiles.warning) recordProblem(archiveFiles.warning, { milestoneId, phaseId });
      let plans = 0;
      for (const file of archiveFiles.entries) {
        const kind = kindForPhaseFile(file);
        if (!kind) continue;
        if (kind === "plan" && ++plans > LIMITS.plansPerPhase) { recordProblem("limit-reached", { milestoneId, phaseId }); break; }
        await add(join("milestones", entry, phaseEntry, file), kind, { milestoneId, phaseId });
      }
    }
  }
  return { available: true, root: root.root, planningRoot: root.planningRoot, archiveIds, artifacts, problems, warnings: warningList(warnings), limited };
}
