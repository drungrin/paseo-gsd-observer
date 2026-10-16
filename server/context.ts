import { ContextTextSchema, decisionIdPattern, type BoardContext, type BoardContextPhase } from "../shared/context.js";
import type { BoardOverview } from "../shared/overview.js";
import { LIMITS, type AllowedArtifact, type AllowedInventory } from "./allowed-reader.js";
import { redactedText } from "./safe-prose.js";

type Section = BoardContextPhase["sourceSections"][number];
type DecisionGroup = BoardContextPhase["decisionGroups"][number];
type Decision = DecisionGroup["decisions"][number];
// The bold lead of a numbered item and its wording: "**D-01:**", "**D-27 — Title.**", "**D-10a (qualifier):**", "**`D-93` [note]:**".
const decisionLead = new RegExp(`^\\*\\*\`?(${decisionIdPattern})\`?(?:\\s+[—–-]\\s+(.+?)|\\s*(\\([^)]*\\)|\\[[^\\]]*\\]))?\\s*:?\\*\\*\\s*(?:[:—–-]\\s*)?(.*)$`);
const maxDecisionText = 640;
const maxDecisionTitle = 240;
const tags = new Set(["domain", "decisions", "specifics", "canonical_refs", "code_context", "deferred", "spec_lock"]);
const maxContexts = 32;
const maxExcerptCharacters = 8_000;
// Decisions are the tab's subject, so the redundant source excerpts never use up their budget.
const maxDecisionCharacters = 16_000;
const safeExcerpt = (value: string | null | undefined, max: number) => {
  // A fraction slash only imitates a path separator, so it never passes for a displayable path.
  const text = redactedText(value?.replace(/⁄/g, "[omitted]"), max);
  return text && ContextTextSchema(max).safeParse(text).success ? text : null;
};

const unclosedBold = (value: string) => (value.match(/\*\*/g)?.length ?? 0) % 2 === 1;

/** A bold decision lead that wraps ("- **D-06 — The remember box" + "  restores the session.** Checked: …") is joined so its lead is read whole. */
function joinWrappedLeads(lines: readonly string[]): string[] {
  const joined: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index];
    if (/^\s*[-*]\s+\*\*`?[A-Z]-\d/.test(line) && unclosedBold(line)) {
      for (let next = index + 1; next < Math.min(lines.length, index + 4) && /^\s+\S/.test(lines[next]) && !/^\s*[-*]\s/.test(lines[next]); next += 1) {
        line = `${line} ${lines[next].trim()}`;
        index = next;
        if (!unclosedBold(line)) break;
      }
    }
    joined.push(line);
  }
  return joined;
}

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
  // Whether each numbered item seen so far carried a title or qualifier.
  const decisionIds = new Map<string, boolean>();
  let section: string | null = null;
  let heading = "";
  let group: DecisionGroup | null = null;
  let openDecision: { group: DecisionGroup; decision: Decision; shortened: boolean } | null = null;
  let source: Section | null = null;
  let excerptCharacters = 0;
  let decisionCharacters = 0;
  let fenced = false;
  const append = (items: string[], value: string, maxItems: number, maxLength = 640) => {
    const safe = safeExcerpt(value, maxLength);
    if (!safe || items.length >= maxItems || excerptCharacters + safe.length > maxExcerptCharacters) { result.excerptsLimited = true; return; }
    items.push(safe);
    excerptCharacters += safe.length;
  };
  // Safe wording up to the display limit; longer wording is cut at a word and marked "…" rather than withheld. Null means unsafe.
  const fit = (value: string, max: number): { text: string; shortened: boolean } | null => {
    const safe = safeExcerpt(value, 8_192);
    if (!safe || safe.length <= max) return safe ? { text: safe, shortened: false } : null;
    const visible = safe.slice(0, max - 1);
    const text = `${visible.slice(0, Math.max(visible.lastIndexOf(" "), max >> 1)).trimEnd()}…`;
    return ContextTextSchema(max).safeParse(text).success ? { text, shortened: true } : null;
  };
  const size = (decision: Decision) => decision.text.length + (decision.title?.length ?? 0);
  // Wording that cannot be shown safely withholds the whole decision, never part of it.
  const withholdDecision = () => {
    if (openDecision) {
      const { decisions } = openDecision.group;
      decisions.splice(decisions.indexOf(openDecision.decision), 1);
      decisionCharacters -= size(openDecision.decision);
    }
    openDecision = null;
    result.excerptsLimited = true;
  };
  const shortenDecision = () => {
    if (!openDecision || openDecision.shortened) return;
    const { decision } = openDecision;
    openDecision.shortened = true;
    result.excerptsLimited = true;
    if (!decision.text) return;
    const text = decision.text.length < maxDecisionText ? `${decision.text}…` : `${decision.text.slice(0, maxDecisionText - 1).replace(/\s+\S*$/, "")}…`;
    decisionCharacters += text.length - decision.text.length;
    decision.text = text;
  };
  const continueDecision = (value: string) => {
    if (!openDecision) { result.excerptsLimited = true; return; }
    if (openDecision.shortened) return;
    const { decision } = openDecision;
    const combined = fit(decision.text ? `${decision.text} ${value}` : value, maxDecisionText);
    if (!combined) { withholdDecision(); return; }
    const growth = combined.text.length - decision.text.length;
    if (decisionCharacters + growth > maxDecisionCharacters) { shortenDecision(); return; }
    decisionCharacters += growth;
    decision.text = combined.text;
    if (combined.shortened) { openDecision.shortened = true; result.excerptsLimited = true; }
  };
  /** False when the document is ambiguous (a plain repeated ID) or holds more numbered items than can be attributed. */
  const startDecision = (id: string, title: string | undefined, wording: string): boolean => {
    openDecision = null;
    const annotated = decisionIds.get(id);
    // A repeat where either entry carries a title or qualifier ("D-04 (clarified, …)") amends the decision in place.
    if (annotated !== undefined && !annotated && !title) return false;
    if (result.decisionCount >= 128) return false;
    if (annotated !== undefined) result.amendmentsObserved = true;
    decisionIds.set(id, Boolean(annotated || title));
    result.decisionCount += 1;
    // Decisions written straight under a "##" heading are grouped by it; those under no heading, as "Decisions".
    if (!group && !/discretion/i.test(heading) && result.decisionGroups.length < 12) {
      group = { title: heading || "Decisions", decisions: [] };
      result.decisionGroups.push(group);
    }
    const target = group;
    const safeTitle = title ? fit(title.replace(/[\s.:]+$/, ""), maxDecisionTitle) : null;
    const body = wording.trim() ? fit(wording, maxDecisionText) : { text: "", shortened: false };
    const decision: Decision | null = body && (!title || safeTitle) ? { id, title: safeTitle?.text ?? null, text: body.text } : null;
    if (!decision || !target || target.decisions.length >= 32 || decisionCharacters + size(decision) > maxDecisionCharacters) { result.excerptsLimited = true; return true; }
    target.decisions.push(decision);
    decisionCharacters += size(decision);
    openDecision = { group: target, decision, shortened: body!.shortened || Boolean(safeTitle?.shortened) };
    if (openDecision.shortened) result.excerptsLimited = true;
    return true;
  };
  for (const line of joinWrappedLeads(lines)) {
    const trimmed = line.trim();
    // Code inside a decision is never shown, so the decision reads as shortened at that point.
    if (/^(?:`{3,}|~{3,})/.test(trimmed)) { if (section === "decisions") shortenDecision(); fenced = !fenced; continue; }
    if (!trimmed) continue;
    if (fenced || /^<!--|^<\/?(?:details|content|invoke)\b|^\*?(?:Phase:|Context gathered:)/i.test(trimmed)) continue;
    const open = /^<([a-z_]+)>$/.exec(trimmed);
    const close = /^<\/([a-z_]+)>$/.exec(trimmed);
    if (open && tags.has(open[1])) {
      if (section || seen.has(open[1])) return { ...phase, observation: "unavailable", excerptsLimited: true };
      section = open[1]; seen.add(section); heading = ""; group = null; openDecision = null;
      if (section === "canonical_refs") result.referencesObserved = true;
      source = { title: section.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase()), lines: [] };
      if (result.sourceSections.length < 8 && section !== "canonical_refs") result.sourceSections.push(source);
      else source = null;
      continue;
    }
    if (close && tags.has(close[1])) {
      if (section !== close[1]) return { ...phase, observation: "unavailable", excerptsLimited: true };
      section = null; group = null; openDecision = null; source = null; continue;
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
      openDecision = null;
      if (section === "decisions" && subsection[0].startsWith("###")) {
        group = null;
        if (!/discretion/i.test(heading) && result.decisionGroups.length < 12) {
          group = { title: heading, decisions: [] };
          result.decisionGroups.push(group);
        }
      } else if (section === "decisions") group = null;
      if (section === "code_context" && subsection[0].startsWith("###") && result.insights.length < 4) result.insights.push({ title: heading, lines: [] });
      continue;
    }
    if (/^---$/.test(trimmed)) continue;
    const bullet = /^[-*]\s+(.+)$/.exec(trimmed)?.[1];
    if (section === "decisions" && bullet) {
      const lead = decisionLead.exec(bullet);
      if (lead) {
        if (!startDecision(lead[1], lead[2] ?? lead[3], lead[4])) return { ...phase, observation: "unavailable", excerptsLimited: true };
      } else if (/discretion/i.test(heading)) { openDecision = null; append(result.discretion, bullet, 8); }
      else if (openDecision && /^\s{2,}[-*]\s+/.test(line)) continueDecision(bullet);
      // An unnumbered top-level bullet is a separate note: it ends the decision before it, and is not shown.
      else { openDecision = null; result.excerptsLimited = true; }
    } else if (section === "decisions" && openDecision) continueDecision(trimmed);
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
  // A title-only lead ("**D-12.1-01 — Title**") whose body could not be read shows its title as the decision.
  for (const item of result.decisionGroups) {
    item.decisions = item.decisions.flatMap((decision) => decision.text ? [decision] : decision.title ? [{ ...decision, title: null, text: decision.title }] : []);
  }
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
