import { createHash } from "node:crypto";
import type { BoardSnapshot } from "../shared/board-rpc.js";
import type { AllowedArtifact, AllowedInventory, InventoryWarning } from "./allowed-reader.js";
import { comparePhaseIds, decodeArtifact, decodeReviewStatus, decodeRoadmap, decodeUatStatus, decodeVerification, type RoadmapPhase } from "./gsd-decoder.js";
import { parsePlanDetails } from "./plan-details.js";

type BoardPhase = BoardSnapshot["milestones"][number]["phases"][number];
type BoardPlan = BoardPhase["plans"][number];
type ProofSource = BoardPhase["proof"][number]["source"];
type ProofStatus = BoardPhase["proof"][number]["status"];
type BoardWarning = InventoryWarning | "reconciliation-unavailable";
const warnings = (values: readonly BoardWarning[]) => [...new Set(values)].slice(0, 16);
const proof = (source: ProofSource, status: ProofStatus = "observed", safeId?: string, count?: number) => ({ source, status, ...(safeId ? { safeId } : {}), ...(count === undefined ? {} : { count }) });
const byKind = (items: readonly AllowedArtifact[], kind: AllowedArtifact["kind"]) => items.filter((item) => item.kind === kind);
const safeTitle = (id: string, title?: string) => {
  const value = title?.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200) ?? "";
  return !value || /(?:https?:\/\/|[\\/]|(?:secret|token|password|api[_-]?key)|AKIA[0-9A-Z]{16})/i.test(value) ? `Fase ${id}` : value;
};
const canonicalKey = (value: string) => {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/");
  const planning = normalized.startsWith(".planning/") ? normalized.slice(".planning/".length) : normalized;
  if (!planning || planning.startsWith("/") || planning === ".." || planning.startsWith("../") || planning.split("/").some((part) => part === ".." || !part)) return null;
  return { digestKey: normalized.startsWith(".planning/") ? `.planning/${planning}` : planning, inventoryKey: planning };
};
const digest = (files: readonly { key: string; bytes: Uint8Array }[]) => {
  const parts = files.map((file) => `${file.key}\n${createHash("sha256").update(file.bytes).digest("hex")}\n`).join("");
  return `v1:sha256:${createHash("sha256").update(`v1\n${parts}`, "utf8").digest("hex")}`;
};
const phaseFromState = (artifact: AllowedArtifact) => {
  const text = new TextDecoder().decode(artifact.bytes).replace(/\r\n?/g, "\n");
  const phase = /^Phase:\s*(\d+(?:\.\d+)*)\s*$/im.exec(text)?.[1];
  const status = /^Status:\s*([a-z_]+)\s*$/im.exec(text)?.[1];
  return phase ? { phase: phase.split(".").map((part) => part.replace(/^0+(?=\d)/, "")).join("."), status } : null;
};

export type PhaseFacts = { declared: boolean; itemCount: number; planCount: number | null; summaryCount: number | null; hasContext: boolean; verification: "passed" | "pending" | "invalid" | "unavailable" | "absent"; blockedByReviewOrUat: boolean; unavailable: boolean };
/** Pure, evidence-only precedence. STATE is deliberately outside these inputs. */
export function classifyPhase(facts: PhaseFacts): BoardPhase["column"] {
  if (facts.unavailable) return "unknown";
  if (facts.verification === "passed" && !facts.blockedByReviewOrUat) return "completed";
  if (facts.planCount !== null && facts.summaryCount !== null && facts.planCount > 0 && facts.planCount === facts.summaryCount) return "verifying";
  if (facts.planCount !== null && facts.summaryCount !== null && facts.summaryCount > 0) return "executing";
  if (facts.planCount !== null && facts.planCount > 0) return "planned";
  if (facts.hasContext) return "discussed";
  return facts.declared && facts.itemCount === 0 ? "backlog" : "unknown";
}

function reconciliation(phaseId: string, items: readonly AllowedArtifact[], inventory: AllowedInventory) {
  const reports = byKind(items, "verification").map((artifact) => ({ artifact, decoded: decodeVerification(artifact) }));
  if (!reports.length) return { status: "absent" as const, proof: proof("verification", "pending"), warning: undefined };
  if (reports.length !== 1 || reports[0].decoded.availability !== "available") return { status: "invalid" as const, proof: proof("verification", "unknown"), warning: "inconsistent" as const };
  const report = reports[0].decoded.value;
  if (report.status === "gaps_found" || report.status === "human_needed") return { status: "pending" as const, proof: proof("verification", "pending"), warning: undefined };
  if (report.status !== "passed") return { status: "invalid" as const, proof: proof("verification", "unknown"), warning: "inconsistent" as const };
  const current = items.filter((item) => item.kind === "plan" || item.kind === "summary");
  if (!report.fingerprintDeclared) return current.length === 0 ? { status: "passed" as const, proof: proof("reconciliation", "passed"), warning: undefined } : { status: "unavailable" as const, proof: proof("reconciliation", "unavailable"), warning: "reconciliation-unavailable" as const };
  if (!report.fingerprint) return { status: "invalid" as const, proof: proof("reconciliation", "invalid"), warning: "reconciliation-unavailable" as const };
  const known = new Map(inventory.artifacts.map((artifact) => [artifact.key, artifact]));
  const requested = report.fingerprint.files.map(canonicalKey);
  if (requested.some((entry) => !entry)) return { status: "unavailable" as const, proof: proof("reconciliation", "unavailable"), warning: "reconciliation-unavailable" as const };
  const selected = requested.map((entry) => known.get(entry!.inventoryKey));
  if (selected.some((artifact) => !artifact) || selected.some((artifact) => artifact!.phaseId && artifact!.phaseId !== phaseId)) return { status: "unavailable" as const, proof: proof("reconciliation", "unavailable"), warning: "reconciliation-unavailable" as const };
  const keys = requested.map((entry) => entry!.inventoryKey);
  if (new Set(keys).size !== keys.length || !current.every((artifact) => keys.includes(artifact.key))) return { status: "invalid" as const, proof: proof("reconciliation", "invalid"), warning: "reconciliation-unavailable" as const };
  const files = requested.map((entry, index) => ({ key: entry!.digestKey, bytes: selected[index]!.bytes })).sort((left, right) => left.key.localeCompare(right.key));
  return digest(files) === report.fingerprint.digest ? { status: "passed" as const, proof: proof("reconciliation", "passed"), warning: undefined } : { status: "invalid" as const, proof: proof("reconciliation", "invalid"), warning: "reconciliation-unavailable" as const };
}

function makePhase({ phaseId, declaredTitle, declaredGoal, declaredMode, declaredDependsOn, declaredRequirements, declaredUiHint, declaredSuccessCriteria, declared, items, inventory, milestoneKey }: { phaseId: string; declaredTitle?: string; declaredGoal?: string; declaredMode?: string; declaredDependsOn?: string; declaredRequirements?: readonly string[]; declaredUiHint?: string; declaredSuccessCriteria?: readonly string[]; declared: boolean; items: readonly AllowedArtifact[]; inventory: AllowedInventory; milestoneKey: string }): BoardPhase {
  const phaseWarnings: BoardWarning[] = [...inventory.problems.filter((problem) => problem.phaseId === phaseId && (!problem.milestoneId || problem.milestoneId === milestoneKey)).map((problem) => problem.warning)];
  const decoded = items.map((artifact) => ({ artifact, decoded: decodeArtifact(artifact) }));
  for (const item of decoded) if (item.decoded.availability !== "available") phaseWarnings.push(...item.decoded.warnings);
  const valid = decoded.filter((item): item is { artifact: AllowedArtifact; decoded: Extract<typeof item.decoded, { availability: "available" }> } => item.decoded.availability === "available");
  const planEntries = valid.filter((item) => item.artifact.kind === "plan" && item.decoded.value.planId).map((item) => item.decoded.value.planId!);
  const planTitles = new Map(valid.filter((item) => item.artifact.kind === "plan" && item.decoded.value.planId).map((item) => [item.decoded.value.planId!, item.decoded.value.planTitle]));
  const planInspector = new Map(valid.filter((item) => item.artifact.kind === "plan" && item.decoded.value.planId).map((item) => [item.decoded.value.planId!, { goal: item.decoded.value.planGoal, successCriteria: item.decoded.value.successCriteria ?? [] }]));
  const planArtifacts = new Map(valid.filter((item) => item.artifact.kind === "plan" && item.decoded.value.planId).map((item) => [item.decoded.value.planId!, item.artifact]));
  const summaryEntries = valid.filter((item) => item.artifact.kind === "summary" && item.decoded.value.planId).map((item) => item.decoded.value.planId!);
  const summaryStatuses = new Map(valid.filter((item) => item.artifact.kind === "summary" && item.decoded.value.planId && typeof item.decoded.value.fields.status === "string").map((item) => [item.decoded.value.planId!, item.decoded.value.fields.status as string]));
  const summaryArtifacts = new Map(valid.filter((item) => item.artifact.kind === "summary" && item.decoded.value.planId).map((item) => [item.decoded.value.planId!, item.artifact]));
  const duplicatePlan = new Set(planEntries).size !== planEntries.length;
  if (duplicatePlan || summaryEntries.some((id) => !planEntries.includes(id))) phaseWarnings.push("inconsistent");
  const planIds = [...new Set(planEntries)].sort(comparePhaseIds);
  const paired = new Set(summaryEntries.filter((id) => planIds.includes(id)));
  const plans: BoardPlan[] = planIds.slice(0, 128).map((planId) => { const inspector = planInspector.get(planId); const summaryStatus = summaryStatuses.get(planId); const planArtifact = planArtifacts.get(planId); const summaryArtifact = summaryArtifacts.get(planId); const details = planArtifact ? parsePlanDetails(new TextDecoder().decode(planArtifact.bytes), summaryArtifact ? new TextDecoder().decode(summaryArtifact.bytes) : undefined) : undefined; return { id: `${milestoneKey}:${phaseId}:${planId}`, planId, ...(planTitles.get(planId) ? { title: planTitles.get(planId) } : {}), ...(inspector?.goal ? { goal: inspector.goal } : {}), ...(inspector?.successCriteria.length ? { successCriteria: [...inspector.successCriteria] } : {}), ...(paired.has(planId) && summaryStatus ? { summaryStatus } : {}), ...(details ? { details } : {}), evidenceStatus: paired.has(planId) ? "summary-present" : "planned", summaryPaired: paired.has(planId), availability: "available", proof: [proof("plan", "observed", planId), ...(paired.has(planId) ? [proof("summary", "observed", planId)] : [])], warnings: [] }; });
  const planGoal = planIds.map((id) => planInspector.get(id)?.goal).find((value): value is string => Boolean(value));
  const planSuccessCriteria = [...new Set(planIds.flatMap((id) => planInspector.get(id)?.successCriteria ?? []))].slice(0, 8);
  const goal = declaredGoal ?? planGoal;
  const successCriteria = declaredSuccessCriteria?.length ? declaredSuccessCriteria.slice(0, 8) : planSuccessCriteria;
  const reviewArtifact = byKind(items, "review")[0]; const uatArtifact = byKind(items, "uat")[0];
  const review = reviewArtifact ? decodeReviewStatus(reviewArtifact) : "absent";
  const uat = uatArtifact ? decodeUatStatus(uatArtifact) : "absent";
  const reconcile = reconciliation(phaseId, items, inventory); if (reconcile.warning) phaseWarnings.push(reconcile.warning);
  const blocked = review === "open" || uat === "pending" || uat === "partial" || uat === "failed";
  const column = classifyPhase({ declared, itemCount: items.length, planCount: duplicatePlan ? null : planIds.length, summaryCount: duplicatePlan ? null : paired.size, hasContext: valid.some((item) => item.artifact.kind === "context"), verification: reconcile.status, blockedByReviewOrUat: blocked, unavailable: duplicatePlan || phaseWarnings.some((warning) => warning !== "reconciliation-unavailable") });
  const state = inventory.artifacts.filter((artifact) => artifact.kind === "state").map(phaseFromState).find((entry) => entry?.phase === phaseId);
  const stateMarker = Boolean(state && ((state.status === "executing" && column === "executing") || (state.status === "verifying" && column === "verifying") || (state.status === "completed" && column === "completed")));
  const phaseProof = [...(declared ? [proof("roadmap", "observed", phaseId)] : []), ...byKind(items, "context").map(() => proof("context", "observed", phaseId)), ...planIds.map((id) => proof("plan", "observed", id)), ...(paired.size ? [proof("summary", "observed", undefined, paired.size)] : []), ...(reviewArtifact ? [proof("review", review === "resolved" ? "passed" : review === "open" ? "pending" : "unknown")] : []), ...(uatArtifact ? [proof("uat", uat === "passed" ? "passed" : uat === "unknown" ? "unknown" : "pending")] : []), reconcile.proof, ...(stateMarker ? [proof("state", "observed")] : [])].slice(0, 16);
  return { id: `${milestoneKey}:${phaseId}`, phaseId, title: safeTitle(phaseId, declaredTitle ?? valid.find((item) => item.decoded.value.title)?.decoded.value.title), column, roadmapDeclared: declared, plans, planCount: duplicatePlan ? null : planIds.length, summaryCount: duplicatePlan ? null : paired.size, stateMarker, review, uat, ...(goal ? { goal } : {}), ...(declaredMode ? { mode: declaredMode } : {}), ...(declaredDependsOn ? { dependsOn: declaredDependsOn } : {}), ...(declaredRequirements?.length ? { requirements: [...declaredRequirements] } : {}), ...(declaredUiHint ? { uiHint: declaredUiHint } : {}), ...(successCriteria.length ? { successCriteria } : {}), proof: phaseProof, warnings: warnings(phaseWarnings), availability: phaseWarnings.length ? "unknown" : "available", limited: plans.length < planIds.length || phaseWarnings.includes("limit-reached") || phaseWarnings.includes("observation-limited") };
}

function makeMilestone({ id, title, archived, active, items, roadmapArtifact, inventory }: { id: string; title: string; archived: boolean; active: boolean; items: readonly AllowedArtifact[]; roadmapArtifact?: AllowedArtifact; inventory: AllowedInventory }): BoardSnapshot["milestones"][number] {
  const roadmap = roadmapArtifact ? decodeRoadmap(roadmapArtifact.bytes) : { availability: "unknown" as const, warnings: ["absent" as const] };
  const declared = new Map<string, RoadmapPhase>(); if (roadmap.availability === "available") for (const phase of roadmap.value) declared.set(phase.phaseId, phase);
  const observed = new Set(items.flatMap((artifact) => artifact.phaseId ? [artifact.phaseId] : []));
  const phaseIds = [...new Set([...declared.keys(), ...observed])].sort((left, right) => (declared.has(left) === declared.has(right) ? comparePhaseIds(left, right) : declared.has(left) ? -1 : 1));
  const phases = phaseIds.slice(0, 256).map((phaseId) => { const declaredPhase = declared.get(phaseId); return makePhase({ phaseId, declaredTitle: declaredPhase?.title, declaredGoal: declaredPhase?.goal, declaredMode: declaredPhase?.mode, declaredDependsOn: declaredPhase?.dependsOn, declaredRequirements: declaredPhase?.requirements, declaredUiHint: declaredPhase?.uiHint, declaredSuccessCriteria: declaredPhase?.successCriteria, declared: declared.has(phaseId), items: items.filter((artifact) => artifact.phaseId === phaseId), inventory, milestoneKey: id }); });
  return { id, title, archived, active, availability: roadmap.availability === "available" ? "available" : "unknown", phases, warnings: warnings([...inventory.warnings, ...roadmap.warnings]), limited: inventory.limited || phases.length < phaseIds.length };
}

/** MILESTONES is an index only: accepted labels add unavailable cards, never read paths. */
function indexedArchiveIds(artifacts: readonly AllowedArtifact[]): string[] {
  const ids = new Set<string>();
  for (const artifact of byKind(artifacts, "milestones")) {
    for (const line of new TextDecoder().decode(artifact.bytes).replace(/\r\n?/g, "\n").split("\n")) {
      const match = /^#{2,6}\s+([A-Za-z0-9][A-Za-z0-9._-]{0,63})\s*$/.exec(line);
      if (match) ids.add(match[1]);
    }
  }
  return [...ids];
}

export function buildBoardSnapshot({ workspaceId, inventory, observedAt }: { workspaceId: string; inventory: AllowedInventory; observedAt: string }): BoardSnapshot {
  if (!inventory.available) return { workspaceId, observedAt: null, freshness: "refresh-failed", availability: "unavailable", revision: 0, milestones: [], warnings: warnings(inventory.warnings), limited: inventory.limited };
  const current = inventory.artifacts.filter((artifact) => !artifact.milestoneId); const currentRoadmap = current.find((artifact) => artifact.kind === "roadmap");
  const decodedCurrentRoadmap = currentRoadmap ? decodeRoadmap(currentRoadmap.bytes) : undefined;
  const firstCurrentPhase = decodedCurrentRoadmap?.availability === "available" ? decodedCurrentRoadmap.value[0] : undefined;
  // Preserve the original live-board selection key until a dedicated DTO migration changes it.
  const currentMilestone = makeMilestone({ id: firstCurrentPhase?.phaseId ?? "current", title: firstCurrentPhase?.title ?? "Atual", archived: false, active: true, items: current, roadmapArtifact: currentRoadmap, inventory });
  const archiveIds = [...new Set([...(inventory.archiveIds ?? []), ...inventory.artifacts.flatMap((artifact) => artifact.milestoneId ? [artifact.milestoneId] : []), ...inventory.problems.flatMap((problem) => problem.milestoneId ? [problem.milestoneId] : []), ...indexedArchiveIds(current)])].sort((left, right) => left.localeCompare(right));
  const archives = archiveIds.map((milestoneId) => { const items = inventory.artifacts.filter((artifact) => artifact.milestoneId === milestoneId); return makeMilestone({ id: `archive:${milestoneId}`, title: `Arquivo ${milestoneId}`, archived: true, active: false, items, roadmapArtifact: items.find((artifact) => artifact.kind === "roadmap"), inventory }); });
  return { workspaceId, observedAt, freshness: "current", availability: currentMilestone.availability, revision: 0, milestones: [currentMilestone, ...archives], warnings: warnings(inventory.warnings), limited: inventory.limited };
}
