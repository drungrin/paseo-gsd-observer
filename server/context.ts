import { ContextTextSchema, isWordAlternative, maskWordAlternatives, type BoardContext, type BoardContextPhase } from "../shared/context.js";
import type { BoardOverview } from "../shared/overview.js";
import { LIMITS, type AllowedArtifact, type AllowedInventory } from "./allowed-reader.js";
import { safeText } from "./safe-prose.js";

type Section = BoardContextPhase["sourceSections"][number];
type DecisionGroup = BoardContextPhase["decisionGroups"][number];
const tags = new Set(["domain", "decisions", "specifics", "canonical_refs", "code_context", "deferred", "spec_lock"]);
const maxContexts = 32;
const maxExcerptCharacters = 8_000;
const safeExcerpt = (value: string | null | undefined, max: number) => {
  // Validate word alternatives as ordinary prose; restore them before redacting any remaining location-like token.
  const text = safeText(value && maskWordAlternatives(value.replace(/⁄/g, "[omitted]"), "⁄"), max)?.replace(/⁄/g, "/").replace(/\S*\/\S*/g, (token) =>
    token === "/" || isWordAlternative(token) ? token : "[omitted]");
  return text && text.length <= max && ContextTextSchema(max).safeParse(text).success ? text : null;
};

function emptyPhase(phase: BoardOverview["roadmap"]["phases"][number], observation: BoardContextPhase["observation"]): BoardContextPhase {
  return { id: phase.id, title: safeExcerpt(phase.title, 640) ?? `Phase ${phase.id}`, current: phase.current, observation,
    gatheredAt: null, recordedStatus: null, boundary: [], decisionCount: 0, decisionGroups: [], discretion: [], specifics: [], deferred: [],
    referencesObserved: false, amendmentsObserved: false, insights: [], sourceSections: [], excerptsLimited: false };
}

function parseContext(artifact: AllowedArtifact, phase: BoardContextPhase): BoardContextPhase {
  if (artifact.size > LIMITS.bytesPerFile || artifact.bytes.byteLength > LIMITS.bytesPerFile) return { ...phase, observation: "unavailable" };
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(artifact.bytes).replace(/^﻿/, "").replace(/\r\n?/g, "\n"); }
  catch { return { ...phase, observation: "unavailable" }; }
  const lines = text.split("\n");
  if (!text.trim() || lines.some((line) => line.length > 4096)) return { ...phase, observation: "unavailable" };
  const gathered = /^\*\*Gathered:\*\*\s*(\d{4}-\d{2}-\d{2})\s*$/m.exec(text)?.[1] ?? null;
  const recordedStatus = safeExcerpt(/^\*\*Status:\*\*\s*(.+)$/m.exec(text)?.[1], 64);
  const result: BoardContextPhase = { ...phase, observation: "observed", gatheredAt: gathered, recordedStatus };
  const seen = new Set<string>();
  const decisionIds = new Set<string>();
  let section: string | null = null;
  let heading = "";
  let group: DecisionGroup | null = null;
  let lastDecision: { group: DecisionGroup; id: string } | null = null;
  let source: Section | null = null;
  let excerptCharacters = 0;
  let fenced = false;
  const append = (items: string[], value: string, maxItems: number, maxLength = 640) => {
    const safe = safeExcerpt(value, maxLength);
    if (!safe || items.length >= maxItems || excerptCharacters + safe.length > maxExcerptCharacters) { result.excerptsLimited = true; return; }
    items.push(safe);
    excerptCharacters += safe.length;
  };
  const continueDecision = (value: string) => {
    if (!lastDecision) { result.excerptsLimited = true; return; }
    const decisions = lastDecision.group.decisions;
    const index = decisions.findIndex((item) => item.id === lastDecision!.id);
    if (index < 0) { result.excerptsLimited = true; lastDecision = null; return; }
    const current = decisions[index];
    const combined = safeExcerpt(`${current.text} ${value}`, 640);
    if (!combined || excerptCharacters - current.text.length + combined.length > maxExcerptCharacters) {
      excerptCharacters -= current.text.length;
      decisions.splice(index, 1);
      result.excerptsLimited = true;
      lastDecision = null;
    } else {
      excerptCharacters += combined.length - current.text.length;
      current.text = combined;
    }
  };
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^(?:`{3,}|~{3,})/.test(trimmed)) { if (section === "decisions" && lastDecision) continueDecision("<omitted>"); fenced = !fenced; continue; }
    if (!trimmed) continue;
    if (fenced || /^<!--|^<\/?(?:details|content|invoke)\b|^\*?(?:Phase:|Context gathered:)/i.test(trimmed)) continue;
    const open = /^<([a-z_]+)>$/.exec(trimmed);
    const close = /^<\/([a-z_]+)>$/.exec(trimmed);
    if (open && tags.has(open[1])) {
      if (section || seen.has(open[1])) return { ...phase, observation: "unavailable", excerptsLimited: true };
      section = open[1]; seen.add(section); heading = ""; group = null; lastDecision = null;
      if (section === "canonical_refs") result.referencesObserved = true;
      source = { title: section.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase()), lines: [] };
      if (result.sourceSections.length < 8 && section !== "canonical_refs") result.sourceSections.push(source);
      else source = null;
      continue;
    }
    if (close && tags.has(close[1])) {
      if (section !== close[1]) return { ...phase, observation: "unavailable", excerptsLimited: true };
      section = null; group = null; lastDecision = null; source = null; continue;
    }
    if (!section) {
      if (seen.size && /^#{2,4}\s+/.test(trimmed)) {
        result.amendmentsObserved = true;
        if (!source && result.sourceSections.length < 8) {
          source = { title: "Later amendments", lines: [] };
          result.sourceSections.push(source);
        }
        if (source) append(source.lines, trimmed.replace(/^#{2,4}\s+/, ""), 12);
      } else if (result.amendmentsObserved && source && trimmed !== "---") append(source.lines, trimmed.replace(/^[-*>]\s*/, ""), 12);
      continue;
    }
    const subsection = /^#{2,4}\s+(.+)$/.exec(trimmed);
    if (subsection) {
      heading = safeExcerpt(subsection[1], 120) ?? "Other";
      lastDecision = null;
      if (section === "decisions" && subsection[0].startsWith("###")) {
        group = null;
        if (!/discretion/i.test(heading) && result.decisionGroups.length < 12) {
          group = { title: heading, decisions: [] };
          result.decisionGroups.push(group);
        }
      }
      if (section === "code_context" && subsection[0].startsWith("###") && result.insights.length < 4) result.insights.push({ title: heading, lines: [] });
      continue;
    }
    if (/^---$/.test(trimmed)) continue;
    const bullet = /^[-*]\s+(.+)$/.exec(trimmed)?.[1];
    if (section === "decisions" && bullet) {
      const decision = /^\*\*(D-\d{2,3}):\*\*\s*(.+)$/.exec(bullet);
      if (decision) {
        if (decisionIds.has(decision[1]) || decisionIds.size >= 128) return { ...phase, observation: "unavailable", excerptsLimited: true };
        decisionIds.add(decision[1]); result.decisionCount += 1;
        const safe = safeExcerpt(decision[2], 640);
        lastDecision = null;
        if (!safe || excerptCharacters + safe.length > maxExcerptCharacters || !group || group.decisions.length >= 32) result.excerptsLimited = true;
        else { group.decisions.push({ id: decision[1], text: safe }); excerptCharacters += safe.length; lastDecision = { group, id: decision[1] }; }
      } else if (/discretion/i.test(heading)) { lastDecision = null; append(result.discretion, bullet, 8); }
      else if (lastDecision && /^\s{2,}[-*]\s+/.test(line)) continueDecision(bullet);
      else if (lastDecision) continueDecision("<omitted>");
      else result.excerptsLimited = true;
    } else if (section === "decisions" && lastDecision) continueDecision(trimmed);
    else if (section === "domain" && !bullet) append(result.boundary, trimmed, 3);
    else if (section === "specifics" && bullet) append(result.specifics, bullet, 8);
    else if (section === "deferred" && bullet) append(result.deferred, bullet, 8);
    else if (section === "code_context" && bullet && result.insights.length) append(result.insights[result.insights.length - 1].lines, bullet, 12);
    if (source && section !== "decisions" && section !== "code_context" && trimmed !== bullet) {
      // Source excerpts are deliberately redundant with the cards, and never include locations or commands.
      if (bullet) append(source.lines, bullet, 12);
      else if (section !== "domain" || result.boundary.length <= 3) append(source.lines, trimmed, 12);
    }
  }
  if (section || fenced) return { ...phase, observation: "unavailable", excerptsLimited: true };
  if (!seen.size) result.excerptsLimited = true;
  if (result.decisionCount > result.decisionGroups.reduce((total, item) => total + item.decisions.length, 0)) result.excerptsLimited = true;
  return result;
}

/** Current-milestone excerpts only; never publish artifact keys or the raw document. */
export function buildContext(inventory: AllowedInventory, roadmap: BoardOverview["roadmap"]): BoardContext {
  if (!inventory.available || roadmap.availability !== "available") return { availability: "unavailable", phases: [], limited: inventory.limited };
  let processed = 0;
  let limited = inventory.limited;
  const projected = new Map<string, BoardContextPhase>();
  for (const roadmapPhase of [...roadmap.phases].sort((left, right) => Number(right.current) - Number(left.current))) {
    projected.set(roadmapPhase.id, projectPhase(roadmapPhase));
  }
  return { availability: "available", phases: roadmap.phases.map((phase) => projected.get(phase.id)!), limited };

  function projectPhase(roadmapPhase: BoardOverview["roadmap"]["phases"][number]): BoardContextPhase {
    const candidates = inventory.artifacts.filter((artifact) => artifact.kind === "context" && artifact.phaseId === roadmapPhase.id);
    const problems = inventory.problems.some((problem) => problem.phaseId === roadmapPhase.id && problem.kind === "context" && problem.warning !== "absent");
    const base = emptyPhase(roadmapPhase, candidates.length || problems || inventory.limited ? "unavailable" : "not_observed");
    if (!candidates.length) return base;
    if (candidates.length !== 1 || processed >= maxContexts) { limited = true; return base; }
    const artifact = candidates[0];
    const name = artifact.key.split(/[\\/]/).at(-1) ?? "";
    const prefix = /^(?:(\d+(?:\.\d+)*)-)?CONTEXT\.md$/i.exec(name)?.[1];
    if (!/^(?:(?:\d+(?:\.\d+)*)-)?CONTEXT\.md$/i.test(name) || prefix && prefix.split(".").map((part) => String(Number(part))).join(".") !== roadmapPhase.id) return base;
    processed += 1;
    const parsed = parseContext(artifact, base);
    if (parsed.observation !== "observed" || parsed.excerptsLimited) limited = true;
    return parsed;
  }
}
