import { PathRecoverySchema, PathReviewSetSchema, PathReviewsSchema, type PathPanel, type PathRecovery, type PathReviews, type PathReviewSet, type PathWarning, type PathWaveReview } from "../shared/path.js";
import type { AllowedArtifact, AllowedInventory } from "./allowed-reader.js";
import { atxHeading } from "./document-text.js";
import type { LogEntry } from "./path-overview.js";
import { dashed, firstLabelled, headings, pathDocument, proseLines, shortExcerpt, token, withoutComments } from "./path-text.js";

/**
 * Review files under `review/`, named as both editions name them: `wave-N.cycleC.md` (with a `.contract` or `.adversarial` lens
 * for deep reviews), `wave-N.cycleC.panel.md` with optional per-family files, `PLAN-PANEL.md`, `FINAL.md`, `final-gap-N.md` and
 * `PATCH-FINDINGS.md`. Verdicts are shown as the reviewer recorded them.
 */

const panelFile = /^wave-(\d{1,4})\.cycle(\d{1,4})\.panel(?:\.([a-z][a-z0-9-]{0,31}))?\.md$/;
const waveFile = /^wave-(\d{1,4})\.cycle(\d{1,4})(?:\.([a-z][a-z0-9-]{0,31}))?\.md$/;
const planPanelFile = /^(?:PLAN-PANEL|plan-panel)(?:[.-]([a-z][a-z0-9-]{0,31}))?\.md$/;
const gapFile = /^final-gap-(\d{1,4})\.md$/;
const recoveryKey = /^plan\/build-recovery-([0-9a-f]{40})\/review\/([^/]+)$/;
const taskVerdict = /^(T\d{3,6})\b.*:\s*(pass|fail)\s*$/i;
const criterionVerdict = /^-\s+\*\*Verdict\*\*:\s*([A-Za-z-]+)/;
// A wave verdict the runtime accepts; only these let a later cycle replace an earlier one.
const settled = new Set(["pass", "blocked"]);

const emptySet = (): PathReviewSet => ({ waves: [], planPanel: null, final: null, gaps: [], patchFindings: false, otherFiles: [] });
export const emptyReviews = (availability: PathReviews["availability"]): PathReviews => ({ availability, current: emptySet(), recoveries: [], limited: false });

const count = (value: string | null) => value && /^\d{1,6}$/.test(value) ? Number(value) : null;

/** Lines before the first level-2 heading, where every review file keeps its own fields. */
function header(lines: readonly string[]): string[] {
  const end = lines.findIndex((line) => atxHeading(line, 0)?.level === 2);
  return end < 0 ? [...lines] : lines.slice(0, end);
}

function panel(lines: readonly string[]): PathPanel {
  const fields = header(lines);
  const families = (firstLabelled(fields, "Families", true) ?? "").split(",").map((item) => token(item)).filter((item): item is string => item !== null);
  return { families: [...new Set(families)].slice(0, 16), actionable: count(firstLabelled(fields, "Actionable", true)), warnings: count(firstLabelled(fields, "Warnings", true)), conflicts: count(firstLabelled(fields, "Conflicts", true)), familyFiles: [] };
}

function waveReview(wave: number, cycle: number, lens: string | null, lines: readonly string[]): PathWaveReview {
  const fields = header(lines);
  const tasks = new Map<string, "pass" | "fail">();
  for (const line of lines) {
    const heading = atxHeading(line, 0);
    const match = heading?.level === 2 ? taskVerdict.exec(heading.text) : null;
    if (match && !tasks.has(match[1])) tasks.set(match[1], match[2].toLowerCase() as "pass" | "fail");
  }
  return {
    wave, cycle, lens: lens ?? token(firstLabelled(fields, "Lens", true)),
    verdict: token(firstLabelled(fields, "Wave verdict", true)), depth: token(firstLabelled(fields, "Depth", true)),
    tasksReviewed: count(firstLabelled(fields, "Tasks reviewed", true)),
    tasks: [...tasks].sort(([left], [right]) => left.localeCompare(right)).slice(0, 512).map(([id, verdict]) => ({ id, verdict })),
    superseded: false, panel: null,
  };
}

function finalReview(lines: readonly string[]): NonNullable<PathReviewSet["final"]> {
  const criteria = headings(lines, 3).slice(0, 128).map((section) => {
    const { lead, rest } = dashed(section.heading);
    const id = /^SC\d{1,4}$/.test(lead) ? lead : null;
    const verdict = section.lines.map((line) => criterionVerdict.exec(line.trim())?.[1]).find(Boolean);
    return { id, text: shortExcerpt(id ? rest : section.heading, 240).text, verdict: token(verdict) };
  });
  return { verdict: token(firstLabelled(header(lines), "Overall verdict", true)), criteria };
}

/** One folder's review files as a set: wave cycles with their panels, the plan panel, the final and gap reviews. */
function reviewSet(files: readonly { name: string; bytes: Uint8Array }[], warnings: Set<PathWarning>, current: boolean): PathReviewSet {
  const set = emptySet();
  const waves = new Map<string, PathWaveReview>();
  const panels = new Map<string, PathPanel>();
  const familyFiles = new Map<string, string[]>();
  const planFamilies: string[] = [];
  for (const { name, bytes } of [...files].sort((left, right) => left.name.localeCompare(right.name))) {
    const text = pathDocument(bytes);
    const lines = text === null ? null : proseLines(withoutComments(text));
    if (!lines) { warnings.add("reviews-malformed"); continue; }
    const panelMatch = panelFile.exec(name);
    const waveMatch = panelMatch ? null : waveFile.exec(name);
    const planMatch = planPanelFile.exec(name);
    const gapMatch = gapFile.exec(name);
    if (panelMatch) {
      const key = `${Number(panelMatch[1])}:${Number(panelMatch[2])}`;
      if (panelMatch[3]) familyFiles.set(key, [...(familyFiles.get(key) ?? []), panelMatch[3]]);
      else panels.set(key, panel(lines));
    } else if (waveMatch) {
      const review = waveReview(Number(waveMatch[1]), Number(waveMatch[2]), waveMatch[3] ?? null, lines);
      waves.set(`${review.wave}:${review.cycle}:${review.lens ?? ""}`, review);
    } else if (planMatch) {
      if (planMatch[1]) planFamilies.push(planMatch[1]);
      else set.planPanel = panel(lines);
    } else if (name === "FINAL.md") set.final = finalReview(lines);
    else if (gapMatch) {
      const fields = header(lines);
      set.gaps.push({ number: Number(gapMatch[1]), verdict: token(firstLabelled(fields, "Gap verdict", true)), risk: shortExcerpt(firstLabelled(fields, "Risk"), 200).text });
    } else if (name === "PATCH-FINDINGS.md") set.patchFindings = true;
    else if (set.otherFiles.length < 64) set.otherFiles.push(name);
  }
  // A panel summarizes one wave cycle; with no review file for that cycle it still shows, beside an unrecorded verdict.
  for (const [key, summary] of panels) {
    const [wave, cycle] = key.split(":").map(Number);
    const families = [...new Set(familyFiles.get(key) ?? [])].slice(0, 16);
    const reviews = [...waves.values()].filter((review) => review.wave === wave && review.cycle === cycle);
    const withPanel = { ...summary, familyFiles: families };
    if (reviews.length) for (const review of reviews) review.panel = withPanel;
    else waves.set(`${key}:`, { wave, cycle, lens: null, verdict: null, depth: null, tasksReviewed: null, tasks: [], superseded: false, panel: withPanel });
  }
  if (set.planPanel) set.planPanel.familyFiles = [...new Set(planFamilies)].slice(0, 16);
  else if (planFamilies.length && set.otherFiles.length < 64) set.otherFiles.push(...planFamilies.map((family) => `PLAN-PANEL.${family}.md`).slice(0, 64 - set.otherFiles.length));
  set.waves = [...waves.values()].sort((left, right) => left.wave - right.wave || left.cycle - right.cycle || (left.lens ?? "").localeCompare(right.lens ?? "")).slice(0, 256);
  if (current) {
    // Only a later cycle with a verdict the runtime accepts replaces an earlier one; a review still being written does not.
    for (const review of set.waves) review.superseded = set.waves.some((later) => later.wave === review.wave && later.lens === review.lens && later.cycle > review.cycle && settled.has(later.verdict ?? ""));
  }
  set.gaps.sort((left, right) => left.number - right.number);
  set.gaps = set.gaps.slice(0, 64);
  if (PathReviewSetSchema.safeParse(set).success) return set;
  warnings.add("reviews-malformed");
  return emptySet();
}

const named = (artifact: AllowedArtifact) => ({ name: artifact.key.split("/").at(-1) ?? "", bytes: artifact.bytes });

/** The current milestone's reviews, and the review sets build recoveries set aside, dated from their `build recovery` log entries. */
export function buildReviews(inventory: AllowedInventory, entries: readonly LogEntry[] | null, warnings: Set<PathWarning>): PathReviews {
  const problems = inventory.problems.filter((item) => item.kind === "path-review" || item.kind === "path-recovery-review");
  if (problems.length) warnings.add("reviews-unavailable");
  const limited = problems.some((item) => item.warning === "limit-reached" || item.warning === "observation-limited");
  const current = inventory.artifacts.filter((item) => item.kind === "path-review").map(named);
  const byRecovery = new Map<string, { name: string; bytes: Uint8Array }[]>();
  for (const artifact of inventory.artifacts.filter((item) => item.kind === "path-recovery-review")) {
    const match = recoveryKey.exec(artifact.key);
    if (match) byRecovery.set(match[1], [...(byRecovery.get(match[1]) ?? []), { name: match[2], bytes: artifact.bytes }]);
  }
  const observed = inventory.watchDirectories?.includes("review") || byRecovery.size > 0;
  if (!observed) return { ...emptyReviews(problems.length ? "unavailable" : "absent"), limited };
  const recoveries: PathRecovery[] = [...byRecovery].map(([base, files]) => {
    const entry = entries?.find((item) => item.text?.includes(base) && /build recovery/i.test(item.text));
    const recovery: PathRecovery = { base: base.slice(0, 7), date: entry?.date ?? null, kind: token(/"kind":\s*"([a-z-]+)"/.exec(entry?.text ?? "")?.[1]), reviews: reviewSet(files, warnings, false) };
    return PathRecoverySchema.safeParse(recovery).success ? recovery : { ...recovery, kind: null };
  }).sort((left, right) => (left.date ?? "9999").localeCompare(right.date ?? "9999") || left.base.localeCompare(right.base)).slice(0, 32);
  const reviews: PathReviews = { availability: "available", current: reviewSet(current, warnings, true), recoveries, limited };
  return PathReviewsSchema.safeParse(reviews).success ? reviews : { ...emptyReviews("unavailable"), limited: true };
}
