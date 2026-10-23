import { join } from "node:path";
import { comparePhaseIds } from "./gsd-decoder.js";
import { readPathInventory } from "./path-reader.js";
import { DIRECTORY_ENTRIES, FILE_BYTES, listDirectory, readSafeFile, SNAPSHOT_BYTES, TIMEOUT_MS, validateSafeDirectory, withTimeout } from "./safe-files.js";
import { resolveWorkspaceRoot, type Flavor } from "./workspace-root.js";

export const LIMITS = {
  bytesPerFile: FILE_BYTES,
  bytesPerSnapshot: SNAPSHOT_BYTES,
  directoryEntries: DIRECTORY_ENTRIES,
  artifacts: 2048,
  phases: 256,
  plansPerPhase: 128,
  titleLength: 200,
  identifierLength: 64,
  warningsPerItem: 16,
  timeoutMs: TIMEOUT_MS,
} as const;

export type InventoryWarning = "absent" | "oversize" | "malformed" | "truncated" | "unsupported" | "containment-refused" | "unreadable" | "limit-reached" | "observation-limited" | "inconsistent";
export type PhaseCheckKind = "research" | "spec" | "skeleton" | "security" | "patterns" | "ui-spec" | "ai-spec" | "plan-check" | "ui-check" | "validation" | "windows" | "deferred-items" | "ui-review" | "eval-review" | "coverage";
/** GSD Path documents have their own kinds, so GSD Core projections never read them. */
export type PathArtifactKind = "path-state" | "path-roadmap" | "path-plan" | "path-next-state" | "path-task";
export type ArtifactKind = "roadmap" | "state" | "requirements" | "todo" | "debug" | "context" | "plan" | "summary" | "verification" | "uat" | "review" | PhaseCheckKind | PathArtifactKind;
export type AllowedArtifact = { key: string; kind: ArtifactKind; phaseId?: string; bytes: Uint8Array; size: number };
export type InventoryProblem = { phaseId?: string; kind?: ArtifactKind; warning: InventoryWarning };
/** Debug sessions live apart from `artifacts`: they have their own budget, so they neither starve nor are starved by phase evidence. */
export type AllowedInventory = { available: boolean; flavor?: Flavor; root?: string; planningRoot?: string; watchDirectories?: string[]; artifacts: AllowedArtifact[]; debugArtifacts?: AllowedArtifact[]; problems: InventoryProblem[]; warnings: InventoryWarning[]; limited: boolean };

const phaseIdPattern = "\\d+(?:\\.\\d+)*";
const phaseDirPattern = new RegExp(`^(${phaseIdPattern})-([A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)$`);
const reservedName = /^(?:\.|\.\.|con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const phaseFilePattern = /^(?:(\d+(?:\.\d+)*(?:-\d+)?)-)?(CONTEXT|PLAN|SUMMARY|VERIFICATION|UAT|REVIEW|REVIEWS)\.md$/i;
const optionalPhaseFilePattern = /^(?:(\d+(?:\.\d+)*)-)?(RESEARCH|SPEC|SKELETON|SECURITY|PATTERNS|UI-SPEC|AI-SPEC|PLAN-CHECK|UI-CHECK|VALIDATION|WINDOWS|deferred-items|UI-REVIEW|EVAL-REVIEW|COVERAGE)\.md$/;
const OPTIONAL_BYTES = 8 * 1024 * 1024;
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

/** The phase STATE.md names as current, read only to order phase directories: a wrong guess changes what a full budget drops first, never what is shown. */
function currentPhaseHint(bytes: Uint8Array | undefined): string | null {
  if (!bytes) return null;
  const text = new TextDecoder().decode(bytes.subarray(0, 16_384));
  const value = /^current_phase:\s*["']?(\d+(?:\.\d+)*)/m.exec(text)?.[1] ?? /^\W*Phase\W*:\W*(\d+(?:\.\d+)*)/m.exec(text)?.[1];
  return value && isSafeSegment(value) ? canonicalPhaseId(value) : null;
}

/** Current planning evidence only: root documents, current phases and their checks, TODOs and debug sessions; GSD Path workspaces read their own allowlist. */
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
  if (root.flavor === "gsd-path") return readPathInventory(root.root, root.planningRoot);
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
  // The current phase first, then newest to oldest, so a full budget or phase cap drops the oldest evidence, in the same order on every run.
  const current = currentPhaseHint(artifacts.find((artifact) => artifact.kind === "state")?.bytes);
  const ordered = phases.entries.flatMap((entry) => {
    const match = phaseDirPattern.exec(entry);
    return match && isSafeSegment(match[1]) && isSafeSegment(match[2]) ? [{ entry, phaseId: canonicalPhaseId(match[1]) }] : [];
  }).sort((a, b) => Number(b.phaseId === current) - Number(a.phaseId === current) || comparePhaseIds(b.phaseId, a.phaseId) || (a.entry < b.entry ? -1 : 1));
  let phaseCount = 0;
  for (const { entry, phaseId } of ordered) {
    if (++phaseCount > LIMITS.phases) { recordProblem("limit-reached"); break; }
    const phasePath = join(root.planningRoot, "phases", entry);
    const phaseWarning = await validateSafeDirectory(root.planningRoot, phasePath);
    if (phaseWarning) { recordProblem(phaseWarning === "absent" ? "containment-refused" : phaseWarning, { phaseId }); continue; }
    watchDirectories.push(join("phases", entry));
    const files = await listDirectory(phasePath);
    if (files.warning) recordProblem(files.warning, { phaseId });
    let plans = 0;
    for (const file of files.entries.sort()) {
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
  return { available: true, flavor: "gsd-core", root: root.root, planningRoot: root.planningRoot, watchDirectories, artifacts, debugArtifacts, problems, warnings: warningList(warnings), limited };
}
