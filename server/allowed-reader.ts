import { constants, type Stats } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { isStrictDescendant, resolveWorkspaceRoot } from "./workspace-root.js";

export const LIMITS = {
  bytesPerFile: 256 * 1024,
  bytesPerSnapshot: 8 * 1024 * 1024,
  directoryEntries: 2048,
  artifacts: 512,
  phases: 256,
  plansPerPhase: 128,
  titleLength: 200,
  identifierLength: 64,
  warningsPerItem: 16,
  timeoutMs: 10_000,
} as const;

export type InventoryWarning = "absent" | "oversize" | "malformed" | "truncated" | "unsupported" | "containment-refused" | "unreadable" | "limit-reached" | "observation-limited" | "inconsistent";
export type PhaseCheckKind = "research" | "spec" | "skeleton" | "security" | "patterns" | "ui-spec" | "ai-spec" | "plan-check" | "ui-check" | "validation" | "windows" | "deferred-items" | "ui-review" | "eval-review" | "coverage";
export type ArtifactKind = "roadmap" | "state" | "requirements" | "todo" | "debug" | "context" | "plan" | "summary" | "verification" | "uat" | "review" | PhaseCheckKind;
export type AllowedArtifact = { key: string; kind: ArtifactKind; phaseId?: string; bytes: Uint8Array; size: number };
export type InventoryProblem = { phaseId?: string; kind?: ArtifactKind; warning: InventoryWarning };
/** Debug sessions live apart from `artifacts`: they have their own budget, so they neither starve nor are starved by phase evidence. */
export type AllowedInventory = { available: boolean; root?: string; planningRoot?: string; watchDirectories?: string[]; artifacts: AllowedArtifact[]; debugArtifacts?: AllowedArtifact[]; problems: InventoryProblem[]; warnings: InventoryWarning[]; limited: boolean };

const phaseIdPattern = "\\d+(?:\\.\\d+)*";
const phaseDirPattern = new RegExp(`^(${phaseIdPattern})-([A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)$`);
const reservedName = /^(?:\.|\.\.|con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const phaseFilePattern = /^(?:(\d+(?:\.\d+)*(?:-\d+)?)-)?(CONTEXT|PLAN|SUMMARY|VERIFICATION|UAT|REVIEW|REVIEWS)\.md$/i;
const optionalPhaseFilePattern = /^(?:(\d+(?:\.\d+)*)-)?(RESEARCH|SPEC|SKELETON|SECURITY|PATTERNS|UI-SPEC|AI-SPEC|PLAN-CHECK|UI-CHECK|VALIDATION|WINDOWS|deferred-items|UI-REVIEW|EVAL-REVIEW|COVERAGE)\.md$/;
const OPTIONAL_BYTES = 2 * 1024 * 1024;
const TODO_BYTES = 2 * 1024 * 1024;
const TODO_FILES = 128;
export const TODO_DIRECTORIES = ["pending", "backlog", "deferred", "done", "completed"] as const;
const DEBUG_BYTES = 3 * 1024 * 1024;
const DEBUG_FILES = 160;
export const DEBUG_DIRECTORIES = ["resolved"] as const;

const isSafeSegment = (value: string) => value.length > 0 && value.length <= LIMITS.identifierLength && !reservedName.test(value) && !/[\\/\0\r\n]/.test(value);
export const isAllowedTodoFile = (name: string) => name.length <= 200 && /^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*\.md$/.test(name);
export const isAllowedDebugFile = isAllowedTodoFile;
const canonicalPhaseId = (value: string) => value.split(".").map((part) => part.replace(/^0+(?=\d)/, "")).join(".");
const warningList = (values: readonly InventoryWarning[]) => [...new Set(values)].slice(0, LIMITS.warningsPerItem);
const withTimeout = async <T>(work: Promise<T>, timeoutMs: number = LIMITS.timeoutMs): Promise<T> => new Promise<T>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("timed out")), timeoutMs);
  void work.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
});
const isMissing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === "ENOENT";
async function safeStat(path: string): Promise<{ stat?: Stats; warning?: InventoryWarning }> {
  try { return { stat: await lstat(path) }; }
  catch (error) { return { warning: isMissing(error) ? "absent" : "unreadable" }; }
}

async function readSafeFile(planningRoot: string, file: string): Promise<{ bytes?: Uint8Array; warning?: InventoryWarning }> {
  const parent = dirname(file);
  const parentResult = await safeStat(parent);
  if (!parentResult.stat) return { warning: parentResult.warning };
  const parentBefore = parentResult.stat;
  if (!parentBefore.isDirectory() || parentBefore.isSymbolicLink()) return { warning: "containment-refused" };
  const beforeResult = await safeStat(file);
  if (!beforeResult.stat) return { warning: beforeResult.warning };
  const before = beforeResult.stat;
  if (!before.isFile() || before.isSymbolicLink()) return { warning: "containment-refused" };
  if (before.size > LIMITS.bytesPerFile) return { warning: "oversize" };
  let canonical: string;
  try { canonical = await realpath(file); }
  catch (error) { return { warning: isMissing(error) ? "inconsistent" : "unreadable" }; }
  if (!isStrictDescendant(planningRoot, canonical)) return { warning: "containment-refused" };
  let handle;
  try {
    handle = await open(canonical, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const descriptor = await handle.stat();
    if (!descriptor.isFile() || descriptor.dev !== before.dev || descriptor.ino !== before.ino || descriptor.size !== before.size) return { warning: "inconsistent" };
    const buffer = Buffer.alloc(Math.min(descriptor.size, LIMITS.bytesPerFile) + 1);
    const result = await handle.read(buffer, 0, buffer.length, 0);
    const after = await handle.stat();
    const parentAfter = await safeStat(parent);
    if (parentAfter.warning === "unreadable") return { warning: "unreadable" };
    if (!parentAfter.stat || parentAfter.stat.dev !== parentBefore.dev || parentAfter.stat.ino !== parentBefore.ino || result.bytesRead > LIMITS.bytesPerFile || after.size > LIMITS.bytesPerFile) return { warning: result.bytesRead > LIMITS.bytesPerFile || after.size > LIMITS.bytesPerFile ? "oversize" : "inconsistent" };
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
  const result = await safeStat(path);
  if (!result.stat) return result.warning;
  if (!result.stat.isDirectory() || result.stat.isSymbolicLink()) return "containment-refused";
  let canonical: string;
  try { canonical = await realpath(path); }
  catch (error) { return isMissing(error) ? "inconsistent" : "unreadable"; }
  return isStrictDescendant(planningRoot, canonical) ? undefined : "containment-refused";
}

function kindForPhaseFile(name: string): ArtifactKind | null {
  const match = phaseFilePattern.exec(name);
  if (!match) return null;
  return match[2].toLowerCase() as ArtifactKind;
}

function optionalKindForPhaseFile(name: string, phaseId: string): PhaseCheckKind | null {
  const match = optionalPhaseFilePattern.exec(name);
  if (!match || (match[1] && (!isSafeSegment(match[1]) || canonicalPhaseId(match[1]) !== phaseId))) return null;
  return match[2].toLowerCase() as PhaseCheckKind;
}

/** Current planning evidence only: root documents, current phases and their checks, TODOs and debug sessions. */
export async function readAllowedInventory(directory: string): Promise<AllowedInventory> {
  try {
    return await withTimeout(readInventory(directory));
  } catch {
    return { available: false, artifacts: [], problems: [], warnings: ["unreadable"], limited: false };
  }
}

async function readInventory(directory: string): Promise<AllowedInventory> {
  const startedAt = Date.now();
  const root = await resolveWorkspaceRoot(directory);
  if (!root.available) return { available: false, artifacts: [], problems: [], warnings: [root.warning], limited: false };
  const artifacts: AllowedArtifact[] = [];
  const problems: InventoryProblem[] = [];
  const warnings: InventoryWarning[] = [];
  let limited = false;
  let totalBytes = 0;
  const optionalCandidates: { key: string; kind: PhaseCheckKind; phaseId: string }[] = [];
  const optionalTruncatedPhases = new Set<string>();
  const watchDirectories: string[] = [];
  const debugArtifacts: AllowedArtifact[] = [];
  const addOptionalChecks = async () => {
    let optionalBytes = 0;
    const deadline = Math.min(startedAt + LIMITS.timeoutMs - 1_000, Date.now() + 1_000);
    for (const candidate of optionalCandidates) {
      const scope = { kind: candidate.kind, phaseId: candidate.phaseId };
      if (artifacts.length >= LIMITS.artifacts) { problems.push({ ...scope, warning: "limit-reached" }); continue; }
      if (Date.now() >= deadline) { problems.push({ ...scope, warning: "observation-limited" }); continue; }
      const result: { bytes?: Uint8Array; warning?: InventoryWarning } = await withTimeout(readSafeFile(root.planningRoot, join(root.planningRoot, candidate.key)), deadline - Date.now()).catch(() => ({ warning: "observation-limited" }));
      if (!result.bytes) { problems.push({ ...scope, warning: result.warning ?? "unreadable" }); continue; }
      if (optionalBytes + result.bytes.byteLength > OPTIONAL_BYTES || totalBytes + result.bytes.byteLength > LIMITS.bytesPerSnapshot) { problems.push({ ...scope, warning: "observation-limited" }); continue; }
      try { new TextDecoder("utf-8", { fatal: true }).decode(result.bytes); }
      catch { problems.push({ ...scope, warning: "malformed" }); continue; }
      optionalBytes += result.bytes.byteLength;
      totalBytes += result.bytes.byteLength;
      artifacts.push({ ...candidate, bytes: result.bytes, size: result.bytes.byteLength });
    }
  };
  const recordProblem = (warning: InventoryWarning, scope: Omit<InventoryProblem, "warning"> = {}) => {
    problems.push({ ...scope, warning });
    warnings.push(warning);
    if (warning === "limit-reached" || warning === "observation-limited") limited = true;
  };
  const add = async (key: string, kind: ArtifactKind, scope: Omit<AllowedArtifact, "key" | "kind" | "bytes" | "size"> = {}) => {
    const unavailable = (warning: InventoryWarning) => {
      if (kind === "context") problems.push({ ...scope, kind, warning });
      else recordProblem(warning, scope);
    };
    if (artifacts.length >= LIMITS.artifacts) return unavailable("limit-reached");
    const result = await readSafeFile(root.planningRoot, join(root.planningRoot, key));
    if (!result.bytes) return unavailable(result.warning ?? "unreadable");
    if (totalBytes + result.bytes.byteLength > LIMITS.bytesPerSnapshot) return unavailable("observation-limited");
    totalBytes += result.bytes.byteLength;
    artifacts.push({ key, kind, ...scope, bytes: result.bytes, size: result.bytes.byteLength });
  };

  for (const [name, kind] of [["ROADMAP.md", "roadmap"], ["STATE.md", "state"]] as const) await add(name, kind);
  // Optional evidence is read last: its absence or limits never change the snapshot's warnings or limited state.
  const addRequirements = async () => {
    if (artifacts.length >= LIMITS.artifacts) { problems.push({ kind: "requirements", warning: "limit-reached" }); return; }
    const result = await readSafeFile(root.planningRoot, join(root.planningRoot, "REQUIREMENTS.md"));
    if (!result.bytes) {
      if (result.warning !== "absent") problems.push({ kind: "requirements", warning: result.warning ?? "unreadable" });
      return;
    }
    if (totalBytes + result.bytes.byteLength > LIMITS.bytesPerSnapshot) { problems.push({ kind: "requirements", warning: "observation-limited" }); return; }
    totalBytes += result.bytes.byteLength;
    artifacts.push({ key: "REQUIREMENTS.md", kind: "requirements", bytes: result.bytes, size: result.bytes.byteLength });
  };
  const addTodos = async () => {
    const deadline = Math.min(startedAt + LIMITS.timeoutMs - 1_000, Date.now() + 2_000);
    const bounded = async <T>(work: Promise<T>): Promise<T | null> => {
      const remaining = deadline - Date.now();
      return remaining > 0 ? withTimeout(work, remaining).catch(() => null) : null;
    };
    const todoProblem = (warning: InventoryWarning) => { problems.push({ kind: "todo", warning }); };
    const todosRoot = join(root.planningRoot, "todos");
    const rootWarning = await bounded(validateSafeDirectory(root.planningRoot, todosRoot));
    if (rootWarning === null) { todoProblem("observation-limited"); return; }
    if (rootWarning === "absent") { todoProblem("absent"); return; }
    if (rootWarning) { todoProblem(rootWarning); return; }
    watchDirectories.push("todos");
    let todoBytes = 0;
    let fileCount = 0;
    let limitReported = false;
    for (const directory of ["pending", "backlog", "deferred", "", "completed", "done"]) {
      const path = directory ? join(todosRoot, directory) : todosRoot;
      if (directory) {
        const warning = await bounded(validateSafeDirectory(root.planningRoot, path));
        if (warning === null) { todoProblem("observation-limited"); return; }
        if (warning === "absent") continue;
        if (warning) { todoProblem(warning); continue; }
        watchDirectories.push(`todos/${directory}`);
      }
      const listing = await bounded(listDirectory(path));
      if (!listing) { todoProblem("observation-limited"); return; }
      if (listing.warning) todoProblem(listing.warning);
      for (const name of listing.entries.sort()) {
        if (!isAllowedTodoFile(name)) continue;
        if (fileCount >= TODO_FILES || artifacts.length >= LIMITS.artifacts) {
          if (!limitReported) todoProblem("limit-reached");
          limitReported = true;
          break;
        }
        fileCount += 1;
        const result = await bounded(readSafeFile(root.planningRoot, join(path, name)));
        if (!result) { todoProblem("observation-limited"); return; }
        if (!result.bytes) { todoProblem(result.warning ?? "unreadable"); continue; }
        if (todoBytes + result.bytes.byteLength > TODO_BYTES || totalBytes + result.bytes.byteLength > LIMITS.bytesPerSnapshot) {
          todoProblem("observation-limited");
          continue;
        }
        try { new TextDecoder("utf-8", { fatal: true }).decode(result.bytes); }
        catch { todoProblem("malformed"); continue; }
        todoBytes += result.bytes.byteLength;
        totalBytes += result.bytes.byteLength;
        artifacts.push({ key: join("todos", directory, name), kind: "todo", bytes: result.bytes, size: result.bytes.byteLength });
      }
    }
  };
  // Read last, into its own list and byte budget: phase evidence never sees these files.
  const addDebug = async () => {
    const deadline = Math.min(startedAt + LIMITS.timeoutMs - 1_000, Date.now() + 2_000);
    const bounded = async <T>(work: Promise<T>): Promise<T | null> => {
      const remaining = deadline - Date.now();
      return remaining > 0 ? withTimeout(work, remaining).catch(() => null) : null;
    };
    const debugProblem = (warning: InventoryWarning) => { problems.push({ kind: "debug", warning }); };
    const debugRoot = join(root.planningRoot, "debug");
    const rootWarning = await bounded(validateSafeDirectory(root.planningRoot, debugRoot));
    if (rootWarning === null) { debugProblem("observation-limited"); return; }
    if (rootWarning === "absent") { debugProblem("absent"); return; }
    if (rootWarning) { debugProblem(rootWarning); return; }
    watchDirectories.push("debug");
    let debugBytes = 0;
    let fileCount = 0;
    for (const directory of ["", ...DEBUG_DIRECTORIES]) {
      const path = directory ? join(debugRoot, directory) : debugRoot;
      if (directory) {
        const warning = await bounded(validateSafeDirectory(root.planningRoot, path));
        if (warning === null) { debugProblem("observation-limited"); return; }
        if (warning === "absent") continue;
        if (warning) { debugProblem(warning); continue; }
        watchDirectories.push(`debug/${directory}`);
      }
      const listing = await bounded(listDirectory(path));
      if (!listing) { debugProblem("observation-limited"); return; }
      if (listing.warning) debugProblem(listing.warning);
      for (const name of listing.entries.sort()) {
        if (!isAllowedDebugFile(name)) continue;
        if (fileCount >= DEBUG_FILES) { debugProblem("limit-reached"); return; }
        fileCount += 1;
        const result = await bounded(readSafeFile(root.planningRoot, join(path, name)));
        if (!result) { debugProblem("observation-limited"); return; }
        if (!result.bytes) { debugProblem(result.warning ?? "unreadable"); continue; }
        if (debugBytes + result.bytes.byteLength > DEBUG_BYTES) { debugProblem("observation-limited"); continue; }
        try { new TextDecoder("utf-8", { fatal: true }).decode(result.bytes); }
        catch { debugProblem("malformed"); continue; }
        debugBytes += result.bytes.byteLength;
        debugArtifacts.push({ key: join("debug", directory, name), kind: "debug", bytes: result.bytes, size: result.bytes.byteLength });
      }
    }
  };

  const phasesRoot = join(root.planningRoot, "phases");
  const phasesRootWarning = await validateSafeDirectory(root.planningRoot, phasesRoot);
  if (!phasesRootWarning) watchDirectories.push("phases");
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
    watchDirectories.push(join("phases", entry));
    const files = await listDirectory(phasePath);
    if (files.warning) recordProblem(files.warning, { phaseId });
    let plans = 0;
    for (const file of files.entries) {
      const optionalKind = optionalKindForPhaseFile(file, phaseId);
      if (optionalKind) {
        if (optionalCandidates.length < LIMITS.artifacts) optionalCandidates.push({ key: join("phases", entry, file), kind: optionalKind, phaseId });
        else if (!optionalTruncatedPhases.has(`${phaseId}:${optionalKind}`)) { problems.push({ phaseId, kind: optionalKind, warning: "limit-reached" }); optionalTruncatedPhases.add(`${phaseId}:${optionalKind}`); }
        continue;
      }
      const kind = kindForPhaseFile(file);
      if (!kind) continue;
      if (kind === "plan" && ++plans > LIMITS.plansPerPhase) { recordProblem("limit-reached", { phaseId }); break; }
      await add(join("phases", entry, file), kind, { phaseId });
    }
  }

  await addRequirements();
  await addOptionalChecks();
  await addTodos();
  await addDebug();
  return { available: true, root: root.root, planningRoot: root.planningRoot, watchDirectories, artifacts, debugArtifacts, problems, warnings: warningList(warnings), limited };
}
