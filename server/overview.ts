import type { BoardOverview } from "../shared/overview.js";
import { safePlanText, safeText } from "./safe-prose.js";
import { atxHeading } from "./document-text.js";
import { buildContext } from "./context.js";
import { buildUat } from "./uat.js";
import { buildValidation } from "./validation.js";
import { buildVerification } from "./verification.js";
import { buildTodos } from "./todos.js";
import { buildParkingLot } from "./parking-lot.js";
import { buildDebug } from "./debug.js";
import { summaryIntro } from "./summary-intro.js";
import { LIMITS, type AllowedArtifact, type AllowedInventory, type ArtifactKind } from "./allowed-reader.js";
import { comparePhaseIds, decodeArtifact, type DecodedArtifact } from "./gsd-decoder.js";

type Warning = BoardOverview["warnings"][number];
type State = BoardOverview["state"];
type Counts = { completed: number | null; total: number | null; conflict?: boolean };
const emptyState = (): State => ({ availability: "unavailable", milestone: null, milestoneName: null, phaseId: null, phaseName: null, status: null, plan: null, lastActivity: null, updatedAt: null });
const emptyRoadmap = (): BoardOverview["roadmap"] => ({ availability: "unavailable", phases: [], completedPhases: 0, totalPhases: 0, percent: null });
const emptyRequirements = (): BoardOverview["requirements"] => ({ availability: "unavailable", completed: 0, total: 0, percent: null, mapped: null });
const emptyPlans = (limited: boolean): BoardOverview["plans"] => ({ availability: "unavailable", phases: [], observedPlans: 0, observedSummaries: 0, limited });
const emptyCounts = (): Counts => ({ completed: null, total: null });
const phaseId = (value: string) => /^\d+(?:\.\d+)*$/.test(value) && value.length <= 64 ? value.split(".").map((part) => part.replace(/^0+(?=\d)/, "")).join(".") : null;
const percent = (completed: number | null, total: number | null) => completed !== null && total !== null && total > 0 ? Math.round(completed / total * 100) : null;
const markdown = (value: string) => value.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\*\*|__|`|\*/g, "").trim();
function readDocument(artifact: AllowedArtifact | undefined, kind: "state" | "roadmap" | "requirements", warnings: Set<Warning>): string | null {
  if (!artifact) { warnings.add(`${kind}-unavailable`); return null; }
  if (artifact.bytes.byteLength > LIMITS.bytesPerFile || artifact.size > LIMITS.bytesPerFile) {
    warnings.add(`${kind}-unavailable`);
    warnings.add(kind === "roadmap" ? "roadmap-limited" : kind === "requirements" ? "requirements-limited" : "state-malformed");
    return null;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(artifact.bytes).replace(/^﻿/, "").replace(/\r\n?/g, "\n");
    if (!text.trim() || text.split("\n").some((line) => line.length > 4096)) {
      warnings.add(`${kind}-malformed`);
      if (kind === "roadmap" && text.trim()) warnings.add("roadmap-limited");
      return null;
    }
    return text;
  } catch {
    warnings.add(`${kind}-malformed`);
    return null;
  }
}

/** Preserve line boundaries while excluding examples and collapsed history. */
function visibleLines(text: string): string[] {
  let fence: { char: string; length: number } | undefined;
  let details = 0;
  let comment = false;
  return text.split("\n").map((line) => {
    if (fence) {
      const closing = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (closing && closing[1][0] === fence.char && closing[1].length >= fence.length) fence = undefined;
      return "";
    }
    const opening = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (opening && !details && !comment) { fence = { char: opening[1][0], length: opening[1].length }; return ""; }
    if (comment || line.includes("<!--")) {
      comment = !line.includes("-->");
      return "";
    }
    const tags = [...line.matchAll(/<\/?details\b[^>]*>/gi)];
    const hidden = details > 0 || tags.length > 0;
    for (const tag of tags) details = Math.max(0, details + (tag[0].startsWith("</") ? -1 : 1));
    return hidden || /^(?: {4}|\t)/.test(line) ? "" : line;
  });
}

const stateKeys = new Set(["milestone", "milestone_name", "current_phase", "current_phase_name", "status", "last_updated", "last_activity", "last_activity_desc"]);
function scalar(value: string): string | null {
  const text = value.trim();
  if (!text || /^(?:null|~)$/i.test(text)) return null;
  if (text.startsWith('"')) {
    const quoted = /^("(?:[^"\\]|\\.)*")(?:\s+#.*)?$/.exec(text)?.[1];
    if (!quoted) throw new Error("invalid scalar");
    const parsed: unknown = JSON.parse(quoted);
    if (typeof parsed !== "string") throw new Error("invalid scalar");
    return parsed;
  }
  if (text.startsWith("'")) {
    const quoted = /^'((?:[^']|'')*)'(?:\s+#.*)?$/.exec(text);
    if (!quoted) throw new Error("invalid scalar");
    return quoted[1].replace(/''/g, "'");
  }
  if (/^[\[\]{}&*!|>]|^(?:true|false)$/i.test(text)) throw new Error("unsupported scalar");
  return text.replace(/\s+#.*$/, "").trim();
}

function parseState(text: string | null, warnings: Set<Warning>): State {
  const state = emptyState();
  if (text === null) return state;
  const fields = new Map<string, string | null>();
  let body = text;
  if (text.startsWith("---\n")) {
    const lines = text.split("\n");
    const end = lines.findIndex((line, index) => index > 0 && /^(?:---|\.\.\.)\s*$/.test(line));
    if (end < 0 || end > 512) { warnings.add("state-malformed"); return state; }
    body = lines.slice(end + 1).join("\n");
    for (const line of lines.slice(1, end)) {
      if (!line.trim() || /^\s|^#/.test(line)) continue;
      const match = /^([a-zA-Z][\w-]*):\s*(.*)$/.exec(line);
      if (!match) { warnings.add("state-malformed"); continue; }
      if (!stateKeys.has(match[1])) continue;
      if (fields.has(match[1])) { fields.set(match[1], null); warnings.add("state-malformed"); continue; }
      try { fields.set(match[1], scalar(match[2])); }
      catch { fields.set(match[1], null); warnings.add("state-malformed"); }
    }
  }
  const fallback = new Map<string, string | null>();
  let inPosition = false;
  let sawPosition = false;
  for (const line of visibleLines(body)) {
    const heading = atxHeading(line);
    if (heading) {
      inPosition = !sawPosition && /^Current Position$/i.test(markdown(heading.text));
      if (inPosition) sawPosition = true;
      continue;
    }
    if (!inPosition) continue;
    const match = /^(Milestone(?: Name)?|Phase(?: Name)?|Plan|Status|Last activity|Last updated|Updated):\s*(.+)$/i.exec(markdown(line));
    if (!match) continue;
    const key = match[1].toLowerCase();
    if (fallback.has(key)) { fallback.set(key, null); warnings.add("state-malformed"); }
    else fallback.set(key, match[2]);
  }
  const clean = (value: string | null | undefined, max = 640) => {
    const result = safeText(value, max);
    if (value && !result) warnings.add("state-malformed");
    return result;
  };
  const bodyMilestone = /^(v?\d+(?:\.\d+)*(?:-[a-z0-9.-]+)?)(?:\s*[:—–-]\s*(.+))?$/i.exec(fallback.get("milestone") ?? "");
  state.milestone = clean(fields.get("milestone"), 64) ?? clean(bodyMilestone?.[1], 64);
  state.milestoneName = clean(fields.get("milestone_name"), 200) ?? clean(fallback.get("milestone name") ?? bodyMilestone?.[2], 200);
  const bodyPhase = /^(\d+(?:\.\d+)*)(?:\s+of\s+\d+)?(?:\s*\(([^)]+)\)|\s*[:—–-]\s*(.+))?(?:\s+.*)?$/.exec(fallback.get("phase") ?? "");
  const fmPhase = fields.get("current_phase");
  if (fmPhase && !phaseId(fmPhase)) warnings.add("state-malformed");
  state.phaseId = (fmPhase ? phaseId(fmPhase) : null) ?? (bodyPhase ? phaseId(bodyPhase[1]) : null);
  state.phaseName = clean(fields.get("current_phase_name")) ?? (bodyPhase && phaseId(bodyPhase[1]) === state.phaseId ? clean(fallback.get("phase name") ?? bodyPhase[2] ?? bodyPhase[3]) : null);
  state.status = clean(fields.get("status")) ?? clean(fallback.get("status"));
  state.plan = clean(fallback.get("plan"));
  const activity = clean(fields.get("last_activity"));
  const description = clean(fields.get("last_activity_desc"));
  state.lastActivity = activity && description && !activity.includes(description) ? clean(`${activity} — ${description}`) ?? activity : activity ?? description ?? clean(fallback.get("last activity"));
  const updatedAt = clean(fields.get("last_updated"), 64) ?? clean(fallback.get("last updated") ?? fallback.get("updated"), 64);
  if (updatedAt && /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(updatedAt)) state.updatedAt = updatedAt;
  else if (updatedAt) warnings.add("state-malformed");
  if (Object.entries(state).some(([key, value]) => key !== "availability" && value !== null)) state.availability = "available";
  else warnings.add("state-malformed");
  return state;
}

type Milestone = { id: string; closed: boolean };
type Section = "phases" | "details" | "progress" | "other";
type Scope = { level: number; milestone?: Milestone; section: Section; detailId?: string; excluded: boolean };
const headingMatch = (line: string) => atxHeading(line);
function milestoneHeading(title: string): Milestone | undefined {
  const version = /^(?:[^\p{L}\p{N}]*)(?:Milestone\s*:?\s*)?(v\d+(?:\.\d+)*(?:-[a-z0-9.-]+)?)(?=\s|:|$)/iu.exec(title)?.[1]
    ?? (/^Roadmap\b/i.test(title) ? /\bv\d+(?:\.\d+)*(?:-[a-z0-9.-]+)?\b/i.exec(title)?.[0] : undefined);
  return version ? { id: version.toLowerCase(), closed: /\b(?:archived|closed|shipped|completed|conclu[ií]do|encerrad[oa])\b/i.test(title) } : undefined;
}
function parseCounts(value: string, warnings: Set<Warning>): Counts | undefined {
  const ratio = /^(\d+)\s*(?:\/|of)\s*(\d+|TBD)\b/i.exec(value);
  const totalOnly = /^(\d+)(?:\s+plans?\b|\s*$)/i.exec(value);
  if (!ratio && !totalOnly) return undefined;
  const completed = ratio ? Number(ratio[1]) : null;
  const total = ratio ? /^TBD$/i.test(ratio[2]) ? null : Number(ratio[2]) : Number(totalOnly![1]);
  if ((completed !== null && !Number.isSafeInteger(completed)) || (total !== null && !Number.isSafeInteger(total)) || (completed !== null && total !== null && completed > total)) {
    warnings.add("plan-count-conflict");
    return { ...emptyCounts(), conflict: true };
  }
  return { completed, total };
}
const differs = (a: Counts, b: Counts) => (a.completed !== null && b.completed !== null && a.completed !== b.completed) || (a.total !== null && b.total !== null && a.total !== b.total);
function sameSourceCounts(values: Counts[], warnings: Set<Warning>): Counts | undefined {
  if (!values.length) return undefined;
  const completed = new Set(values.flatMap((value) => value.completed === null ? [] : [value.completed]));
  const totals = new Set(values.flatMap((value) => value.total === null ? [] : [value.total]));
  if (values.some((value) => value.conflict) || completed.size > 1 || totals.size > 1) {
    warnings.add("plan-count-conflict");
    return { ...emptyCounts(), conflict: true };
  }
  return { completed: [...completed][0] ?? null, total: [...totals][0] ?? null };
}

type DetailPlan = { checked: boolean | null; title: string | null };
type Detail = { plans: Map<string, DetailPlan>; duplicateConflict: boolean; summaries: Counts[] };
function parseRoadmap(text: string | null, state: State, warnings: Set<Warning>, orderedPlans: Map<string, Detail>): BoardOverview["roadmap"] {
  if (text === null) return emptyRoadmap();
  const lines = visibleLines(text);
  const versions = new Set(lines.flatMap((line) => { const heading = headingMatch(line); const milestone = heading ? milestoneHeading(markdown(heading.text)) : undefined; return milestone && !milestone.closed ? [milestone.id] : []; }));
  const selected = state.milestone?.toLowerCase() ?? (versions.size === 1 ? [...versions][0] : undefined);
  if (!selected && versions.size > 1) { warnings.add("roadmap-malformed"); return emptyRoadmap(); }
  const declared = new Map<string, { title: string; completed: boolean }>();
  const details = orderedPlans;
  const tables = new Map<string, Counts[]>();
  const stack: Scope[] = [];
  let lastMilestone: Milestone | undefined;
  let table: { phase: number; counts: number } | undefined;
  for (const line of lines) {
    const heading = headingMatch(line);
    if (heading) {
      table = undefined;
      const level = heading.level;
      const title = markdown(heading.text);
      while (stack.length && stack.at(-1)!.level >= level) stack.pop();
      const parent = stack.at(-1);
      const explicitMilestone = milestoneHeading(title);
      if (explicitMilestone) lastMilestone = explicitMilestone;
      const milestone = explicitMilestone ?? parent?.milestone ?? lastMilestone;
      const phase = /^Phase\s+(\d+(?:\.\d+)*)\s*:/i.exec(title);
      const detailId = phase ? phaseId(phase[1]) ?? undefined : parent?.detailId;
      // Accept the observed overview label, not arbitrary translated qualifiers such as "Phases 历史".
      let section: Section = /^Phases(?:\s*[:(]|[ \t]+概览$|$)/i.test(title) ? "phases" : /^Phase Details\b/i.test(title) ? "details" : /^Progress\b/i.test(title) ? "progress" : "other";
      if (phase || detailId) section = "details";
      else if (explicitMilestone) section = /\bPhase Details\b/i.test(title) ? "details" : /\bPhases\b/i.test(title) ? "phases" : /\bProgress\b/i.test(title) ? "progress" : parent?.section ?? "other";
      const excluded = Boolean(parent?.excluded || milestone?.closed || /^(?:Examples?|History|Archives?|Archived|Closed|Completed Milestones)\b/i.test(title));
      stack.push({ level, milestone, section, detailId, excluded });
      continue;
    }
    const scope = stack.at(-1);
    if (!scope || scope.excluded || (selected && scope.milestone && scope.milestone.id !== selected)) continue;
    if (scope.section === "phases") {
      const declaration = /^ {0,3}[-*+]\s+\[([ xX])\]\s+(?:\*\*)?Phase\s+(\d+(?:\.\d+)*)\s*:\s*(.+)$/i.exec(line);
      if (!declaration) continue;
      const id = phaseId(declaration[2]);
      if (!id) { warnings.add("roadmap-malformed"); continue; }
      const titleText = (declaration[3].includes("**") ? declaration[3].split("**")[0] : declaration[3].split(/\s+[-—–]\s+/)[0]).replace(/\s*\(completed\s+\d{4}-\d{2}-\d{2}\)\s*$/i, "");
      const title = safeText(titleText, 640);
      if (!title) warnings.add("roadmap-malformed");
      const completed = declaration[1].toLowerCase() === "x";
      const existing = declared.get(id);
      if (existing && existing.completed !== completed) { existing.completed = false; warnings.add("roadmap-malformed"); }
      else if (!existing) declared.set(id, { title: title ?? `Phase ${id}`, completed });
    }
    if (scope.section === "details" && scope.detailId) {
      let detail = details.get(scope.detailId);
      if (!detail) { detail = { plans: new Map(), duplicateConflict: false, summaries: [] }; details.set(scope.detailId, detail); }
      const checkbox = /^ {0,3}[-*+]\s+\[([ xX])\]\s+(.+)$/.exec(line);
      if (checkbox) {
        const label = markdown(checkbox[2]);
        const plan = /^(\d+(?:\.\d+)*)-(\d+)-PLAN\.md\b/i.exec(label) ?? /^Plan\s+(\d+(?:\.\d+)*)-(\d+)(?=\s*[:—–-]|\s*$)/i.exec(label);
        if (plan && phaseId(plan[1]) === scope.detailId && plan[2].length <= 64) {
          const id = plan[2].replace(/^0+(?=\d)/, "");
          const checked = checkbox[1].toLowerCase() === "x";
          const description = label.slice(plan[0].length).replace(/^\s*[-—–:]\s*/, "");
          const title = safeText(description, 160);
          const existing = detail.plans.get(id);
          if (existing && existing.checked !== checked) { existing.checked = null; detail.duplicateConflict = true; }
          else if (!existing) detail.plans.set(id, { checked, title });
        }
      }
      const summary = /^Plans\s*:\s*(.+)$/i.exec(markdown(line));
      if (summary) { const counts = parseCounts(summary[1], warnings); if (counts) detail.summaries.push(counts); }
    }
    if (scope.section === "progress" && /^\s*\|/.test(line)) {
      const cells = line.trim().replace(/^\||\|$/g, "").split("|").map(markdown);
      const phaseColumn = cells.findIndex((cell) => /^Phase$/i.test(cell));
      const countsColumn = cells.findIndex((cell) => /^Plans Complete$/i.test(cell));
      if (phaseColumn >= 0 && countsColumn >= 0) { table = { phase: phaseColumn, counts: countsColumn }; continue; }
      if (!table) continue;
      const rowPhase = /^(?:Phase\s+)?(\d+(?:\.\d+)*)(?=\.?\s|\.?$|:)/i.exec(cells[table.phase] ?? "");
      const id = rowPhase ? phaseId(rowPhase[1]) : null;
      if (!id) continue;
      const counts = parseCounts(cells[table.counts] ?? "", warnings);
      if (counts) { const rows = tables.get(id) ?? []; rows.push(counts); tables.set(id, rows); }
    } else if (line.trim()) table = undefined;
  }
  if (!declared.size) { warnings.add("roadmap-malformed"); return emptyRoadmap(); }
  const limited = declared.size > LIMITS.phases;
  if (limited) warnings.add("roadmap-limited");
  const phases = [...declared].sort(([a], [b]) => comparePhaseIds(a, b)).slice(0, LIMITS.phases).map(([id, declaration]) => {
    const detail = details.get(id);
    const list = detail?.plans.size ? { completed: [...detail.plans.values()].filter((plan) => plan.checked === true).length, total: detail.plans.size, conflict: detail.duplicateConflict } : undefined;
    if (detail?.duplicateConflict) warnings.add("plan-count-conflict");
    const tableCounts = sameSourceCounts(tables.get(id) ?? [], warnings);
    const summary = sameSourceCounts(detail?.summaries ?? [], warnings);
    let counts = list ?? tableCounts ?? summary ?? emptyCounts();
    if ([list, tableCounts, summary].some((source) => source && (source.conflict || differs(counts, source)))) {
      warnings.add("plan-count-conflict");
      counts = emptyCounts();
    }
    return { id, title: declaration.title, completed: declaration.completed, current: state.phaseId === id, completedPlans: counts.completed, totalPlans: counts.total, percent: percent(counts.completed, counts.total) };
  });
  if (state.phaseId && !declared.has(state.phaseId)) warnings.add("phase-not-in-roadmap");
  const completedPhases = phases.filter((phase) => phase.completed).length;
  return { availability: "available", phases, completedPhases, totalPhases: phases.length, percent: limited ? null : percent(completedPhases, phases.length) };
}

const requirementSection = /^(?:Requisitos da|Requirements (?:for|of))\s+(v\d+(?:\.\d+)*(?:-[a-z0-9.-]+)?)$/i;
const requirementId = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/;
const checklist = /^ {0,3}- \[([xX ])\] \*\*([A-Z][A-Z0-9-]{0,63})\*\*:\s*\S/;
const traceHeading = /^(?:Rastreabilidade|Traceability)(?:\s+(?:da|do|for|of))?\s*(v\d+(?:\.\d+)*(?:-[a-z0-9.-]+)?)?$/i;

function roadmapMilestone(text: string | null): string | null {
  if (text === null) return null;
  const versions = new Set(visibleLines(text).flatMap((line) => {
    const heading = headingMatch(line);
    const milestone = heading ? milestoneHeading(markdown(heading.text)) : undefined;
    return milestone && !milestone.closed ? [milestone.id] : [];
  }));
  return versions.size === 1 ? [...versions][0] : null;
}

function parseRequirements(text: string | null, state: State, roadmapVersion: string | null, warnings: Set<Warning>): BoardOverview["requirements"] {
  if (text === null) return emptyRequirements();
  const lines = visibleLines(text);
  const sections: { version: string; start: number; end: number }[] = [];
  const traces: { version: string | null; start: number; end: number }[] = [];
  for (let index = 0; index < lines.length; index++) {
    const heading = headingMatch(lines[index]);
    if (!heading || heading.level > 2) continue;
    if (sections.at(-1)?.end === lines.length) sections.at(-1)!.end = index;
    if (traces.at(-1)?.end === lines.length) traces.at(-1)!.end = index;
    if (heading.level === 1) continue;
    const title = heading.text.trim();
    const version = requirementSection.exec(title)?.[1];
    if (version) sections.push({ version: version.toLowerCase(), start: index + 1, end: lines.length });
    const traceVersion = traceHeading.exec(title);
    if (traceVersion) traces.push({ version: traceVersion[1]?.toLowerCase() ?? null, start: index + 1, end: lines.length });
  }
  const stateVersion = state.milestone?.toLowerCase() ?? null;
  const selectedVersion = stateVersion && roadmapVersion && stateVersion !== roadmapVersion ? null : stateVersion ?? roadmapVersion;
  const matching = selectedVersion ? sections.filter((section) => section.version === selectedVersion) : [];
  if (matching.length !== 1) {
    warnings.add("requirements-scope-unknown");
    return emptyRequirements();
  }
  const selected = matching[0];
  const checked = new Map<string, boolean>();
  for (const line of lines.slice(selected.start, selected.end)) {
    const match = checklist.exec(line);
    if (match) {
      const id = match[2];
      if (!requirementId.test(id) || checked.has(id)) { warnings.add("requirements-malformed"); return emptyRequirements(); }
      checked.set(id, match[1].toLowerCase() === "x");
      if (checked.size > 256) { warnings.add("requirements-limited"); return emptyRequirements(); }
    } else if (/^ {0,3}(?:[-*+]|\d{1,3}[.)])\s+(?:\[|\*\*[A-Za-z][A-Za-z0-9-]*\*\*\s*:)/.test(line)) {
      warnings.add("requirements-malformed");
      return emptyRequirements();
    }
  }
  const completed = [...checked.values()].filter(Boolean).length;
  const total = checked.size;
  const result: BoardOverview["requirements"] = { availability: "available", completed, total, percent: percent(completed, total), mapped: null };
  if (!traces.length) return result;
  const scopedTraces = traces.filter((trace) => trace.version === selectedVersion || (trace.version === null && sections.length === 1));
  if (scopedTraces.length !== 1) { warnings.add("requirements-trace-conflict"); return result; }
  const trace = scopedTraces[0];
  const table = lines.slice(trace.start, trace.end).filter((line) => /^\s*\|/.test(line));
  const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
  const header = table.findIndex((line) => {
    const values = cells(line);
    return values.length === 3 && /^REQ-ID$/i.test(values[0]) && /^(?:Fase|Phase)$/i.test(values[1]) && /^Status$/i.test(values[2]);
  });
  const separator = header >= 0 ? cells(table[header + 1] ?? "") : [];
  if (header < 0 || separator.length !== 3 || !separator.every((cell) => /^:?-{3,}:?$/.test(cell)) || table.slice(0, header).length) {
    warnings.add("requirements-trace-conflict");
    return result;
  }
  const mapped = new Set<string>();
  let conflict = false;
  let statusConflict = false;
  for (const line of table.slice(header + 2)) {
    const values = cells(line);
    const id = values[0];
    const phase = values[1];
    const status = values[2];
    if (values.length !== 3 || !checked.has(id) || mapped.has(id) || !/^Phase\s+\d+(?:\.\d+)*$/i.test(phase) || !/^(?:Complete|Completed|Pending)$/i.test(status)) { conflict = true; continue; }
    mapped.add(id);
    if (checked.get(id) !== /^Completed?$/i.test(status)) statusConflict = true;
  }
  if (mapped.size !== total || conflict || statusConflict) {
    warnings.add("requirements-trace-conflict");
    if (conflict || statusConflict) result.percent = null;
  } else result.mapped = mapped.size;
  return result;
}

type PhaseChecks = BoardOverview["plans"]["phases"][number]["checks"];
type CheckEvidence = PhaseChecks["discuss"];
const checkStatus = new Set<NonNullable<CheckEvidence["reportedStatus"]>>(["draft", "pending", "validated", "passed", "complete", "clean", "gaps_found", "human_needed", "unknown", "verified", "warning", "open", "resolved", "partial", "failed"]);
const checkFiles = {
  discuss: ["context", "CONTEXT"], research: ["research", "RESEARCH"], verify: ["verification", "VERIFICATION"],
  spec: ["spec", "SPEC"], skeleton: ["skeleton", "SKELETON"], security: ["security", "SECURITY"],
  patterns: ["patterns", "PATTERNS"], uiSpec: ["ui-spec", "UI-SPEC"], aiSpec: ["ai-spec", "AI-SPEC"],
  planCheck: ["plan-check", "PLAN-CHECK"], uiCheck: ["ui-check", "UI-CHECK"], nyquist: ["validation", "VALIDATION"],
  windows: ["windows", "WINDOWS"], deferred: ["deferred-items", "deferred-items"],
  codeReview: ["review", "REVIEW"], uiReview: ["ui-review", "UI-REVIEW"], evalReview: ["eval-review", "EVAL-REVIEW"],
  uat: ["uat", "UAT"], coverage: ["coverage", "COVERAGE"],
} as const;
type CheckName = keyof typeof checkFiles;
const optionalKinds = new Set<ArtifactKind>(["research", "spec", "skeleton", "security", "patterns", "ui-spec", "ai-spec", "plan-check", "ui-check", "validation", "windows", "deferred-items", "ui-review", "eval-review", "coverage"]);

/** Only the first bounded YAML frontmatter contributes literal status and Nyquist compliance. */
function checkMetadata(artifact: AllowedArtifact, nyquist: boolean): Pick<CheckEvidence, "reportedStatus" | "compliant"> {
  const result: Pick<CheckEvidence, "reportedStatus" | "compliant"> = { reportedStatus: null, compliant: null };
  const text = new TextDecoder("utf-8", { fatal: true }).decode(artifact.bytes).replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (!text.startsWith("---\n")) return result;
  const boundary = text.indexOf("\n---\n", 4);
  if (boundary < 0 || boundary > 32_768) return result;
  const lines = text.slice(4, boundary).split("\n");
  if (lines.length > 256 || lines.some((line) => line.length > 512)) return result;
  for (const [key, field] of [["status", "reportedStatus"], ...(nyquist ? [["nyquist_compliant", "compliant"]] : [])] as const) {
    const values = lines.flatMap((line) => line.startsWith(`${key}:`) ? [line.slice(key.length + 1).trim()] : []);
    if (values.length !== 1) continue;
    if (field === "reportedStatus" && checkStatus.has(values[0] as NonNullable<CheckEvidence["reportedStatus"]>)) result.reportedStatus = values[0] as NonNullable<CheckEvidence["reportedStatus"]>;
    if (field === "compliant" && /^(?:true|false)$/.test(values[0])) result.compliant = values[0] === "true";
  }
  return result;
}

function projectChecks(inventory: AllowedInventory, phase: string): PhaseChecks {
  const generalProblem = inventory.problems.some((problem) => !problem.kind && (!problem.phaseId || problem.phaseId === phase) && problem.warning !== "absent");
  const entries = inventory.artifacts.filter((artifact) => artifact.phaseId === phase);
  const select = (name: CheckName): CheckEvidence => {
    const [kind, basename] = checkFiles[name];
    const candidates = entries.filter((artifact) => {
      if (artifact.kind !== kind) return false;
      const match = /^phases\/(\d+(?:\.\d+)*)-[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*\/((?:\d+(?:\.\d+)*-)?[A-Za-z-]+\.md)$/.exec(artifact.key);
      if (!match || phaseId(match[1]) !== phase) return false;
      const filename = match[2];
      const suffix = `${basename}.md`;
      return filename.toLowerCase() === suffix.toLowerCase() || (filename.toLowerCase().endsWith(`-${suffix}`.toLowerCase()) && phaseId(filename.slice(0, -suffix.length - 1)) === phase);
    });
    const problem = generalProblem || inventory.problems.some((entry) => entry.phaseId === phase && entry.kind === kind);
    if (problem || candidates.length > 1 || (candidates.length === 1 && (candidates[0].size > LIMITS.bytesPerFile || candidates[0].size !== candidates[0].bytes.byteLength))) return { observation: "unavailable", reportedStatus: null, compliant: null };
    if (!candidates.length) return { observation: "not_observed", reportedStatus: null, compliant: null };
    try {
      return { observation: "observed", ...checkMetadata(candidates[0], name === "nyquist") };
    } catch { return { observation: "unavailable", reportedStatus: null, compliant: null }; }
  };
  return {
    discuss: select("discuss"), research: select("research"), verify: select("verify"),
    plan: { spec: select("spec"), skeleton: select("skeleton"), security: select("security"), patterns: select("patterns"),
      uiSpec: select("uiSpec"), aiSpec: select("aiSpec"), planCheck: select("planCheck"), uiCheck: select("uiCheck"),
      nyquist: select("nyquist"), windows: select("windows"), deferred: select("deferred") },
    execute: { codeReview: select("codeReview"), uiReview: select("uiReview"), evalReview: select("evalReview"),
      uat: select("uat"), coverage: select("coverage") },
  };
}

type ObservedFile = { artifact: AllowedArtifact; decoded: DecodedArtifact | null };
type PlanFiles = { plan: ObservedFile[]; summary: ObservedFile[] };
const phaseFile = /^phases\/(\d+(?:\.\d+)*)-[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*\/(\d+(?:\.\d+)*)-(\d+)-(PLAN|SUMMARY)\.md$/i;

/** Only literal numeric wave metadata in the first PLAN frontmatter can be displayed. */
function planWave(artifact: AllowedArtifact): number | null {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(artifact.bytes).replace(/\r\n?/g, "\n");
  if (!text.startsWith("---\n")) return null;
  const lines = text.split("\n", 514);
  const end = lines.findIndex((line, index) => index > 0 && line === "---");
  if (end < 0 || end > 512) return null;
  const waves = lines.slice(1, end).flatMap((line) => /^wave:\s*(0|[1-9]\d*)\s*$/.exec(line)?.[1] ?? []);
  if (waves.length !== 1) return null;
  const wave = Number(waves[0]);
  return Number.isSafeInteger(wave) ? wave : null;
}

function planObjective(artifact: AllowedArtifact): string | null {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(artifact.bytes).slice(0, 8_192);
  const matches = [...text.matchAll(/^ {0,3}<objective>\s*([^\n<]{1,640})(?=<|\n|$)/gim)];
  if (matches.length !== 1) return null;
  const statement = matches[0][1].split(/\s+(?:Purpose|Output):/i)[0];
  return safePlanText(statement, 640);
}

function projectPlans(inventory: AllowedInventory, roadmap: BoardOverview["roadmap"], details: Map<string, Detail>, warnings: Set<Warning>): BoardOverview["plans"] {
  const scoped = new Set(roadmap.phases.map((phase) => phase.id));
  let limited = inventory.limited || warnings.has("roadmap-limited") || warnings.has("plan-count-conflict") || inventory.artifacts.length > LIMITS.artifacts ||
    inventory.problems.some((problem) => problem.warning !== "absent" && !optionalKinds.has(problem.kind as ArtifactKind) &&
      (problem.phaseId ? scoped.has(phaseId(problem.phaseId) ?? "") : problem.kind === "plan" || problem.kind === "summary" || !problem.kind));
  if (roadmap.availability !== "available") return emptyPlans(limited);
  const files = new Map<string, Map<string, PlanFiles>>();
  for (const artifact of inventory.artifacts.slice(0, LIMITS.artifacts)) {
    const scopedPhaseId = artifact.phaseId;
    if (!scopedPhaseId || !scoped.has(scopedPhaseId) || (artifact.kind !== "plan" && artifact.kind !== "summary")) continue;
    const match = phaseFile.exec(artifact.key);
    if (!match || match[4].toLowerCase() !== artifact.kind || phaseId(match[1]) !== scopedPhaseId || phaseId(match[2]) !== scopedPhaseId || match[3].length > 64) { limited = true; continue; }
    const number = match[3].replace(/^0+(?=\d)/, "");
    let decodedValue: DecodedArtifact | null = null;
    if (artifact.size <= LIMITS.bytesPerFile && artifact.bytes.byteLength <= LIMITS.bytesPerFile && artifact.size === artifact.bytes.byteLength) {
      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(artifact.bytes);
        if (text.trim()) {
          const decoded = decodeArtifact(artifact);
          if (decoded.availability === "available" && decoded.value.phaseId === artifact.phaseId && decoded.value.planId === number) decodedValue = decoded.value;
        }
      } catch { /* Invalid UTF-8 is not readable evidence. */ }
    }
    if (!decodedValue) limited = true;
    const phaseFiles = files.get(scopedPhaseId) ?? new Map<string, PlanFiles>();
    const entry = phaseFiles.get(number) ?? { plan: [], summary: [] };
    // Keep invalid candidates in the duplicate set: a valid peer cannot resolve ambiguity.
    entry[artifact.kind].push({ artifact, decoded: decodedValue });
    phaseFiles.set(number, entry);
    files.set(scopedPhaseId, phaseFiles);
  }
  let observedPlans = 0;
  let observedSummaries = 0;
  let entriesTotal = 0;
  const phases: BoardOverview["plans"]["phases"] = roadmap.phases.map((phase) => {
    const declared = details.get(phase.id)?.plans ?? new Map<string, DetailPlan>();
    const phaseFiles = files.get(phase.id) ?? new Map<string, PlanFiles>();
    const numbers = [...declared.keys(), ...[...phaseFiles.keys()].filter((number) => !declared.has(number)).sort(comparePhaseIds)];
    const entries: BoardOverview["plans"]["phases"][number]["entries"] = [];
    if (numbers.length > LIMITS.plansPerPhase || numbers.length > 512 - entriesTotal) limited = true;
    for (const number of numbers.slice(0, Math.min(LIMITS.plansPerPhase, 512 - entriesTotal))) {
      const pair = phaseFiles.get(number);
      if ((pair?.plan.length ?? 0) > 1 || (pair?.summary.length ?? 0) > 1) limited = true;
      const plan = pair?.plan.length === 1 ? pair.plan[0] : undefined;
      const summary = pair?.summary.length === 1 ? pair.summary[0] : undefined;
      const title = safePlanText(declared.get(number)?.title, 160) ?? safePlanText(plan?.decoded?.planTitle, 160);
      const objective = safePlanText(plan?.decoded?.planGoal, 640) ?? (plan?.decoded ? planObjective(plan.artifact) : null);
      const introduction = summary?.decoded ? (() => { try { return summaryIntro(summary.artifact); } catch { return { text: null, limited: true }; } })() : { text: null, limited: false };
      const declaration = declared.get(number);
      entries.push({ id: `${phase.id}-${number}`, number, title,
        objective, wave: plan?.decoded ? planWave(plan.artifact) : null, roadmapChecked: declaration?.checked ?? null,
        roadmapConflict: declaration?.checked === null, planObserved: Boolean(plan?.decoded), summaryObserved: Boolean(summary?.decoded),
        summaryExcerpt: introduction.text, summaryExcerptLimited: introduction.limited });
      if (plan?.decoded) observedPlans++;
      if (summary?.decoded) observedSummaries++;
    }
    entriesTotal += entries.length;
    if (details.get(phase.id)?.duplicateConflict) limited = true;
    return { id: phase.id, title: phase.title, current: phase.current, declaredPlans: phase.totalPlans, entries, checks: projectChecks(inventory, phase.id) };
  });
  let excerptCharacters = 0;
  for (const phase of [...phases.filter((item) => item.current), ...phases.filter((item) => !item.current)]) {
    for (const entry of phase.entries) {
      if (!entry.summaryExcerpt) continue;
      if (excerptCharacters + entry.summaryExcerpt.length > 96 * 1024) {
        entry.summaryExcerpt = null;
        entry.summaryExcerptLimited = true;
      } else excerptCharacters += entry.summaryExcerpt.length;
    }
  }
  return { availability: "available", phases, observedPlans, observedSummaries, limited };
}

function findRootArtifact(inventory: AllowedInventory, kind: "state" | "roadmap" | "requirements"): AllowedArtifact | undefined {
  if (!inventory.available) return undefined;
  const filename = kind === "state" ? "STATE.md" : kind === "roadmap" ? "ROADMAP.md" : "REQUIREMENTS.md";
  return inventory.artifacts.find((artifact) =>
    artifact.kind === kind && artifact.key === filename && !artifact.phaseId);
}

/** Pure projection of already-bounded root documents and current phase artifacts. */
export function buildOverview(inventory: AllowedInventory): BoardOverview {
  const warnings = new Set<Warning>();
  const state = parseState(readDocument(findRootArtifact(inventory, "state"), "state", warnings), warnings);
  const roadmapArtifact = findRootArtifact(inventory, "roadmap");
  const roadmapText = readDocument(roadmapArtifact, "roadmap", warnings);
  const roadmapDetails = new Map<string, Detail>();
  const roadmap = parseRoadmap(roadmapText, state, warnings, roadmapDetails);
  if (!roadmapArtifact && inventory.problems.some((problem) => !problem.kind && !problem.phaseId && ["oversize", "truncated", "limit-reached", "observation-limited"].includes(problem.warning))) warnings.add("roadmap-limited");
  const requirementsArtifact = findRootArtifact(inventory, "requirements");
  const requirements = parseRequirements(readDocument(requirementsArtifact, "requirements", warnings), state, roadmapMilestone(roadmapText), warnings);
  if (!requirementsArtifact && inventory.problems.some((problem) => problem.kind === "requirements" && ["oversize", "truncated", "limit-reached", "observation-limited"].includes(problem.warning))) warnings.add("requirements-limited");
  const plans = projectPlans(inventory, roadmap, roadmapDetails, warnings);
  // An ambiguous current milestone is not evidence that the current parking lot is empty.
  const parkingLines = roadmapText !== null && !(roadmap.availability === "unavailable" && warnings.has("roadmap-malformed")) ? visibleLines(roadmapText) : null;
  const parkingMilestone = state.milestone?.toLowerCase() ?? roadmapMilestone(roadmapText);
  return { state, roadmap, requirements, plans, context: buildContext(inventory, roadmap), validation: buildValidation(inventory, roadmap), uat: buildUat(inventory, roadmap), verification: buildVerification(inventory, roadmap), todos: buildTodos(inventory), parkingLot: buildParkingLot(parkingLines, parkingMilestone), debug: buildDebug(inventory), warnings: [...warnings] };
}
