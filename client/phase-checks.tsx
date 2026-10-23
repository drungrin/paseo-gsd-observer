import { Text, View } from "react-native";
import type { BoardOverview } from "../shared/overview.js";
import { plural, type ThemeProps } from "./board-frame.js";
import { kicker, Pill, StationTrack, type Tone, type TrackStation } from "./ui-kit.js";

type Phase = BoardOverview["plans"]["phases"][number];
type Check = Phase["checks"]["discuss"];
type CheckGroup = Phase["checks"]["plan"] | Phase["checks"]["execute"];

export const planChecks = [
  ["spec", "Spec"], ["skeleton", "Skeleton"], ["security", "Security"], ["patterns", "Patterns"],
  ["uiSpec", "UI-Spec"], ["aiSpec", "AI-Spec"], ["planCheck", "Plan-Check"], ["uiCheck", "UI-Check"],
  ["nyquist", "Nyquist"], ["windows", "Windows"], ["deferred", "Deferred"],
] as const;
export const executeChecks = [
  ["codeReview", "Code Review"], ["uiReview", "UI Review"], ["evalReview", "Eval Review"],
  ["uat", "UAT"], ["coverage", "Coverage"],
] as const;

export function checkLabel(check: Check): string {
  if (check.observation === "unavailable") return "Unavailable";
  if (check.observation === "not_observed") return "Not observed";
  const status = check.reportedStatus ? ` · ${check.reportedStatus.replace(/_/g, " ")}` : "";
  const compliance = check.compliant === null ? "" : check.compliant ? " · compliance: yes" : " · compliance: no";
  return `Observed${status}${compliance}`;
}

export function visibleCheckLabel(check: Check): string {
  if (check.observation !== "observed") return checkLabel(check);
  if (check.compliant === false) return check.reportedStatus === "draft" ? "Draft · pending" : "Compliance: no";
  if (check.reportedStatus) return check.reportedStatus.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());
  return "Observed";
}

/** An observed check's tone: failed in danger, open or non-compliant in warning, passed in success; null when nothing was observed. */
export function checkTone(check: Check): Tone | null {
  if (check.observation === "unavailable") return "warning";
  if (check.observation !== "observed") return null;
  if (check.reportedStatus === "failed") return "danger";
  if (check.compliant === false || ["draft", "pending", "open", "partial", "warning", "gaps_found", "human_needed"].includes(check.reportedStatus ?? "")) return "warning";
  if (["passed", "validated", "verified", "complete", "clean", "resolved"].includes(check.reportedStatus ?? "")) return "success";
  return "accent";
}

const glyph = (tone: Tone | null) => tone === "success" ? "✓" : tone === "danger" ? "✕" : tone === "warning" ? "!" : tone ? "●" : "○";

/**
 * A phase's way through GSD Core, from the files it left: discuss and research as their files record, plan when a plan file is
 * observed, execute by observed summaries, verify by the verification report. A stage passed without its file reads as skipped.
 */
export function phaseStages(phase: Phase | undefined, compact = false): TrackStation[] {
  const plans = phase?.entries.filter((entry) => entry.planObserved).length ?? 0;
  const summaries = phase?.entries.filter((entry) => entry.summaryObserved).length ?? 0;
  // The real total: the roadmap's declared plans, or more when plan files outside that list were added (gap closure).
  const confirmed = phase?.declaredPlans !== null && phase?.declaredPlans !== undefined;
  const total = Math.max(phase?.declaredPlans ?? 0, phase?.entries.length ?? 0);
  const executed = summaries > 0 && summaries >= total;
  const verify = phase?.checks.verify;
  const observed = (check: Check | undefined) => check?.observation === "observed";
  // An unreadable file is neither observed nor skipped: the stage says so in the warning color.
  const unreadable = (check: Check | undefined) => check?.observation === "unavailable" ? { detail: "unreadable", tone: "warning" as const } : { detail: null };
  const stages: { key: string; label: string; done: boolean; detail: string | null; tone?: Tone }[] = [
    { key: "discuss", label: "discuss", done: observed(phase?.checks.discuss), ...unreadable(phase?.checks.discuss) },
    { key: "research", label: "research", done: observed(phase?.checks.research), ...unreadable(phase?.checks.research) },
    { key: "plan", label: "plan", done: plans > 0, detail: plans ? plural(plans, "plan") : null },
    { key: "execute", label: "execute", done: executed, detail: summaries || total ? `${summaries}/${total || "?"}${compact ? confirmed ? "" : "?" : confirmed ? " summaries" : " summaries, total TBD"}` : null },
    verify?.observation === "unavailable" ? { key: "verify", label: "verify", done: false, ...unreadable(verify) }
      : { key: "verify", label: "verify", done: observed(verify), detail: verify?.reportedStatus ? verify.reportedStatus.replace(/_/g, " ") : null, tone: verify && observed(verify) ? checkTone(verify) ?? undefined : undefined },
  ];
  const last = stages.reduce((found, stage, index) => stage.done ? index : found, -1);
  return stages.map((stage, index) => ({ key: stage.key, label: stage.label, detail: stage.detail ?? (index < last && !stage.done ? "skipped" : null), tone: stage.tone,
    state: stage.done ? "done" : index < last ? "skipped" : index === last + 1 ? "current" : "future" }));
}

const stageWords = (station: TrackStation) => station.detail === "unreadable" ? "file unreadable" : station.state === "done" ? "observed" : station.state === "skipped" ? "not observed" : station.state === "current" ? "next" : "ahead";
export const stagesLabel = (phase: Phase, stations: readonly TrackStation[]) => `Phase ${phase.id} stages. ${stations.map((station) => `${station.label}: ${stageWords(station)}${station.detail && station.detail !== "skipped" && station.detail !== "unreadable" ? `, ${station.detail}` : ""}`).join("; ")}`;

/** One stage's sub-checks as pills: observed ones in their status's tone, the rest faint. */
function CheckPills({ title, entries, checks, theme, compact }: ThemeProps & { title: string; entries: readonly (readonly [string, string])[]; checks: CheckGroup; compact: boolean }) {
  const byKey = checks as Record<string, Check>;
  const observed = entries.filter(([key]) => byKey[key].observation === "observed").length;
  return <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: compact ? "auto" : 0, minWidth: 0, gap: 8 }}>
    <Text style={kicker(theme)}>{title} · {observed} of {entries.length} observed</Text>
    <View role="list" accessibilityLabel={title} style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {entries.map(([key, label]) => {
        const check = byKey[key];
        const tone = checkTone(check);
        return <View key={key} role="listitem" accessible accessibilityLabel={`${label}: ${checkLabel(check)}`}>
          <Pill theme={theme} tone={tone ?? "neutral"} glyph={glyph(tone)} label={tone ? `${label} · ${visibleCheckLabel(check)}` : label} />
        </View>;
      })}
    </View>
  </View>;
}

/** A phase's stage track and the sub-checks of its plan and execute stages. */
export function PhaseChecks({ phase, theme, compact }: ThemeProps & { phase: Phase; compact: boolean }) {
  const stations = phaseStages(phase, compact);
  return <View style={{ gap: 16 }}>
    <StationTrack theme={theme} compact={compact} stations={stations} label={stagesLabel(phase, stations)} moving={phase.current} />
    <View style={{ flexDirection: compact ? "column" : "row", alignItems: compact ? "stretch" : "flex-start", gap: 16 }}>
      <CheckPills title="Plan sub-stages" entries={planChecks} checks={phase.checks.plan} theme={theme} compact={compact} />
      <CheckPills title="Execute sub-stages" entries={executeChecks} checks={phase.checks.execute} theme={theme} compact={compact} />
    </View>
  </View>;
}
