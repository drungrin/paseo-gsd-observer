import {
  PathMilestoneSchema, PathNextSchema, PathRoadmapSchema, PathStateSchema, PathTimelineSchema,
  type BoardPath, type PathMilestone, type PathRoadmap, type PathState, type PathTimeline, type PathWarning,
} from "../shared/path.js";
import type { AllowedInventory } from "./allowed-reader.js";
import { redactPaths } from "../shared/locations.js";
import { maskDigests } from "./document-text.js";
import {
  branchPattern, dashed, datePattern, firstLabelled, headings, milestoneIdPattern, PATH_PIPELINE, pathDocument, pathFrontmatter,
  proseLines, shortExcerpt, slugPattern, token, withoutComments, type PathFields,
} from "./path-text.js";

const logLine = /^-\s+(\d{4}-\d{2}-\d{2})\s+[—–-]\s+([a-z][a-z-]{0,31})(?:\s+[—–-]\s+(.*))?$/;
const integratedCommit = /^[0-9a-f]{7,40}\b/;
const pattern = (value: string | null | undefined, rule: RegExp) => value && rule.test(value) ? value : null;

export const emptyState = (): PathState => ({ availability: "unavailable", project: null, milestone: null, phase: null, status: null, branch: null, defaultBranch: null, integration: null, integrationDefault: null, shipped: false, lastEvent: null });
export const emptyTimeline = (): PathTimeline => ({ availability: "unavailable", entries: [], logEntries: 0 });
export const emptyRoadmap = (availability: PathRoadmap["availability"]): PathRoadmap => ({ availability, milestones: [], counts: { total: 0, shipped: 0, active: 0, pending: 0, abandoned: 0, other: 0 } });

const artifact = (inventory: AllowedInventory, kind: "path-state" | "path-roadmap" | "path-next-state") => inventory.artifacts.find((item) => item.kind === kind);
const problem = (inventory: AllowedInventory, kind: "path-state" | "path-roadmap" | "path-next-state") => inventory.problems.find((item) => item.kind === kind);

export type StateReading = { setup: BoardPath["setup"]; fields: PathFields | null; body: string | null };

/** Which pipeline the state document names. Only `gsd-path/v2` is parsed; a later format is reported, never guessed at. */
export function readState(inventory: AllowedInventory, warnings: Set<PathWarning>): StateReading {
  const document = artifact(inventory, "path-state");
  if (!document) {
    if (problem(inventory, "path-state")?.warning === "absent") return { setup: "not-started", fields: null, body: null };
    warnings.add("state-unavailable");
    return { setup: "started", fields: null, body: null };
  }
  const text = pathDocument(document.bytes);
  const fields = text === null ? null : pathFrontmatter(text);
  const pipeline = fields?.values.get("pipeline") ?? null;
  if (pipeline !== PATH_PIPELINE && pipeline?.startsWith("gsd-path/")) return { setup: "unsupported", fields: null, body: null };
  if (!fields || pipeline !== PATH_PIPELINE) { warnings.add("state-malformed"); return { setup: "started", fields: null, body: null }; }
  return { setup: "started", fields, body: fields.body };
}

export type LogEntry = { date: string; phase: string; text: string | null };

/** Dated entries of the `## Log` section, oldest first. */
export function logEntries(body: string | null, warnings: Set<PathWarning>): LogEntry[] | null {
  if (body === null) return null;
  const lines = proseLines(withoutComments(body));
  const section = lines && headings(lines, 2).find((entry) => entry.heading.trim().toLowerCase() === "log");
  if (!section) { warnings.add("log-unavailable"); return null; }
  return section.lines.flatMap((line) => {
    const match = logLine.exec(line.trim());
    return match && datePattern.test(match[1]) ? [{ date: match[1], phase: match[2], text: match[3]?.trim() || null }] : [];
  });
}

/**
 * Phases of the current milestone, in the order first entered, as the GSD Path daemon reads them: the log persists across
 * milestones, so only the tail from the latest `define` (or the `inspect` just before it) belongs to this milestone.
 */
export function buildTimeline(entries: readonly LogEntry[] | null, currentPhase: string | null): PathTimeline {
  if (entries === null) return emptyTimeline();
  const runs: LogEntry[] = [];
  for (const entry of entries) if (runs.at(-1)?.phase !== entry.phase) runs.push(entry);
  let start = runs.reduce((latest, entry, index) => entry.phase === "define" ? index : latest, 0);
  if (start > 0 && runs[start - 1].phase === "inspect") start -= 1;
  const phases = new Map<string, { phase: string; since: string; latest: string; visits: number }>();
  for (const run of runs.slice(start)) {
    const seen = phases.get(run.phase);
    if (seen) { seen.latest = run.date; seen.visits += 1; }
    else phases.set(run.phase, { phase: run.phase, since: run.date, latest: run.date, visits: 1 });
  }
  const timeline: PathTimeline = { availability: "available", entries: [...phases.values()].slice(0, 32).map((entry) => ({ ...entry, current: entry.phase === currentPhase })), logEntries: Math.min(entries.length, 100_000) };
  return PathTimelineSchema.safeParse(timeline).success ? timeline : emptyTimeline();
}

export function buildState(reading: StateReading, entries: readonly LogEntry[] | null): PathState {
  const values = reading.fields?.values;
  if (!values) return emptyState();
  const phase = token(values.get("phase"));
  const status = token(values.get("status"));
  const last = entries?.at(-1);
  const masked = last?.text ? redactPaths(maskDigests(last.text)) : null;
  const event = shortExcerpt(masked, 640);
  const state: PathState = {
    availability: "available",
    project: pattern(values.get("project"), slugPattern),
    milestone: pattern(values.get("milestone"), slugPattern),
    phase, status,
    branch: pattern(values.get("branch"), branchPattern),
    defaultBranch: pattern(values.get("default_branch"), branchPattern),
    integration: token(values.get("integration")),
    integrationDefault: token(values.get("integration_default")),
    shipped: phase === "shipped" && status === "done",
    lastEvent: last ? { date: last.date, phase: token(last.phase), text: event.text, shortened: event.shortened || masked !== last.text || (last.text !== null && event.text === null) } : null,
  };
  if (PathStateSchema.safeParse(state).success) return state;
  return PathStateSchema.safeParse({ ...state, lastEvent: null }).success ? { ...state, lastEvent: null } : emptyState();
}

/** Milestones under `### M001 — slug` headings, with their `Status:`, `Goal:`, `Depends on:`, `Archive:` and `Integrated:` lines. */
export function buildRoadmap(inventory: AllowedInventory, currentMilestone: string | null, warnings: Set<PathWarning>): PathRoadmap {
  const document = artifact(inventory, "path-roadmap");
  if (!document) {
    const failure = problem(inventory, "path-roadmap");
    if (!failure) return emptyRoadmap("absent");
    warnings.add("roadmap-unavailable");
    return emptyRoadmap("unavailable");
  }
  const text = pathDocument(document.bytes);
  const lines = text === null ? null : proseLines(withoutComments(text));
  if (!lines) { warnings.add("roadmap-malformed"); return emptyRoadmap("unavailable"); }
  const roadmap = emptyRoadmap("available");
  const seen = new Set<string>();
  for (const section of headings(lines, 3)) {
    const { lead, rest } = dashed(section.heading);
    if (!milestoneIdPattern.test(lead)) continue;
    if (seen.has(lead) || roadmap.milestones.length >= 128) { warnings.add("roadmap-malformed"); continue; }
    seen.add(lead);
    const slug = pattern(rest, slugPattern);
    if (!slug) warnings.add("roadmap-malformed");
    const goal = firstLabelled(section.lines, "Goal");
    const archive = firstLabelled(section.lines, "Archive", true);
    const depends = /^\[(.*)\]$/.exec(firstLabelled(section.lines, "Depends on", true) ?? "")?.[1].split(",").map((item) => item.trim()).filter((item) => milestoneIdPattern.test(item)) ?? [];
    const milestone: PathMilestone = {
      id: lead, slug, status: token(firstLabelled(section.lines, "Status", true)),
      goal: shortExcerpt(goal, 400).text,
      depends: [...new Set(depends)].slice(0, 64),
      archived: archive !== null && archive !== "null",
      integrated: integratedCommit.test(firstLabelled(section.lines, "Integrated", true) ?? ""),
      current: slug !== null && slug === currentMilestone,
    };
    const valid = PathMilestoneSchema.safeParse(milestone).success ? milestone : { ...milestone, goal: null };
    if (!PathMilestoneSchema.safeParse(valid).success) { warnings.add("roadmap-malformed"); continue; }
    roadmap.milestones.push(valid);
    const status = valid.status;
    roadmap.counts.total += 1;
    if (status === "shipped" || status === "active" || status === "pending" || status === "abandoned") roadmap.counts[status] += 1;
    else roadmap.counts.other += 1;
  }
  if (currentMilestone && !roadmap.milestones.some((milestone) => milestone.current)) warnings.add("milestone-not-in-roadmap");
  return PathRoadmapSchema.safeParse(roadmap).success ? roadmap : emptyRoadmap("unavailable");
}

/** The lookahead milestone planned under `.project/next/` while the current one builds. */
export function buildNext(inventory: AllowedInventory, warnings: Set<PathWarning>): BoardPath["next"] {
  const document = artifact(inventory, "path-next-state");
  if (!document) {
    if (problem(inventory, "path-next-state")) warnings.add("next-unavailable");
    return null;
  }
  const text = pathDocument(document.bytes);
  const values = text === null ? null : pathFrontmatter(text)?.values;
  if (!values) { warnings.add("next-unavailable"); return null; }
  const next = { milestone: pattern(values.get("milestone"), slugPattern), phase: token(values.get("phase")), status: token(values.get("status")) };
  return PathNextSchema.safeParse(next).success && (next.milestone || next.phase) ? next : null;
}
