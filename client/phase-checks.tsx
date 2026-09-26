import { Text, View } from "react-native";
import type { BoardOverview } from "../shared/overview.js";
import type { BoardTheme } from "./board-components.js";

type Phase = BoardOverview["plans"]["phases"][number];
type Check = Phase["checks"]["discuss"];
type CheckGroup = Phase["checks"]["plan"] | Phase["checks"]["execute"];

const planChecks = [
  ["spec", "Spec"], ["skeleton", "Skeleton"], ["security", "Security"], ["patterns", "Patterns"],
  ["uiSpec", "UI-Spec"], ["aiSpec", "AI-Spec"], ["planCheck", "Plan-Check"], ["uiCheck", "UI-Check"],
  ["nyquist", "Nyquist"], ["windows", "Windows"], ["deferred", "Deferred"],
] as const;
const executeChecks = [
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

function visibleCheckLabel(check: Check): string {
  if (check.observation !== "observed") return checkLabel(check);
  if (check.compliant === false) return check.reportedStatus === "draft" ? "Draft · pending" : "Compliance: no";
  if (check.reportedStatus) return check.reportedStatus.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());
  return "Observed";
}

function checkColor(check: Check, theme: BoardTheme): string {
  if (check.observation !== "observed") return theme.colors.foregroundMuted;
  if (check.reportedStatus === "failed") return theme.colors.statusDanger ?? theme.colors.statusWarning ?? theme.colors.accent;
  if (check.compliant === false || ["draft", "pending", "open", "partial", "warning", "gaps_found", "human_needed"].includes(check.reportedStatus ?? "")) return theme.colors.statusWarning ?? theme.colors.accent;
  if (["passed", "validated", "verified", "complete", "clean", "resolved"].includes(check.reportedStatus ?? "")) return theme.colors.statusSuccess ?? theme.colors.accent;
  return theme.colors.accent;
}

function CheckRow({ label, check, theme }: { label: string; check: Check; theme: BoardTheme }) {
  return <View accessible accessibilityLabel={`${label}: ${checkLabel(check)}`} style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 36, paddingVertical: 5, borderBottomWidth: 1, borderColor: theme.colors.border ?? theme.colors.foregroundMuted }}>
    <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: checkColor(check, theme) }} />
    <Text style={{ color: theme.colors.foreground, fontSize: 13, flex: 1, minWidth: 0 }}>{label}</Text>
    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, textAlign: "right", flexShrink: 0 }}>{visibleCheckLabel(check)}</Text>
  </View>;
}

function Stage({ title, detail, observation, check, theme }: { title: string; detail: string; observation: Check["observation"]; check?: Check; theme: BoardTheme }) {
  const color = check ? checkColor(check, theme) : observation === "observed" ? theme.colors.accent : theme.colors.foregroundMuted;
  return <View accessible accessibilityLabel={`${title}: ${detail}`} style={{ flex: 1, minWidth: 0, minHeight: 66, padding: 12, gap: 5, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border ?? theme.colors.foregroundMuted, backgroundColor: theme.colors.surface1 ?? theme.colors.surface0 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} /><Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600", flexShrink: 1 }}>{title}</Text></View>
    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, marginLeft: 18 }}>{detail}</Text>
  </View>;
}

function Rail({ phase, theme, compact }: { phase: Phase; theme: BoardTheme; compact: boolean }) {
  const planFiles = phase.entries.filter((entry) => entry.planObserved).length;
  const summaries = phase.entries.filter((entry) => entry.summaryObserved).length;
  const executeTotal = phase.declaredPlans === null ? `${summaries} summaries observed` : `${summaries}/${phase.declaredPlans} summaries observed`;
  const stages = [
    { title: "Discuss", detail: checkLabel(phase.checks.discuss), observation: phase.checks.discuss.observation, check: phase.checks.discuss },
    { title: "Research", detail: checkLabel(phase.checks.research), observation: phase.checks.research.observation, check: phase.checks.research },
    { title: "Plan", detail: planFiles ? `${planFiles} plans observed` : "No plan files observed", observation: planFiles ? "observed" as const : "not_observed" as const },
    { title: "Execute", detail: executeTotal, observation: summaries ? "observed" as const : "not_observed" as const },
    { title: "Verify", detail: checkLabel(phase.checks.verify), observation: phase.checks.verify.observation, check: phase.checks.verify },
  ];
  return <View style={{ gap: 10 }}><Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>Phase progress</Text>
    <View style={{ flexDirection: compact ? "column" : "row", alignItems: compact ? "stretch" : "center", gap: 8 }}>
      {stages.map((stage, index) => <View key={stage.title} style={{ flexDirection: compact ? "column" : "row", alignItems: compact ? "stretch" : "center", flex: compact ? undefined : 1, alignSelf: "stretch", minWidth: 0, gap: 8 }}>
        {index > 0 && !compact && <View style={{ width: 8, height: 1, backgroundColor: theme.colors.border ?? theme.colors.foregroundMuted }} />}
        <Stage {...stage} theme={theme} />
      </View>)}
    </View>
  </View>;
}

function CheckGroupPanel({ title, entries, checks, theme, compact, split }: { title: string; entries: readonly (readonly [string, string])[]; checks: CheckGroup; theme: BoardTheme; compact: boolean; split: boolean }) {
  const first = split ? entries.slice(0, 6) : entries;
  const second = split ? entries.slice(6) : [];
  const render = (items: readonly (readonly [string, string])[]) => <View style={{ flex: 1, minWidth: 0 }}>{items.map(([key, label]) => <CheckRow key={key} label={label} check={checks[key as keyof typeof checks]} theme={theme} />)}</View>;
  return <View style={{ flex: 1, minWidth: 0, padding: 14, gap: 10, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border ?? theme.colors.foregroundMuted, backgroundColor: theme.colors.surface1 ?? theme.colors.surface0 }}>
    <Text style={{ color: theme.colors.foreground, fontSize: 14, fontWeight: "600" }}>{title}</Text>
    <View style={{ flexDirection: compact || !split ? "column" : "row", alignItems: compact ? "stretch" : "flex-start", gap: compact ? 0 : 16 }}>{render(first)}{second.length > 0 && render(second)}</View>
  </View>;
}

export function PhaseChecks({ phase, theme, compact }: { phase: Phase; theme: BoardTheme; compact: boolean }) {
  return <View style={{ gap: 18, paddingHorizontal: compact ? 14 : 18, paddingVertical: 16, borderTopWidth: 1, borderColor: theme.colors.border ?? theme.colors.foregroundMuted }}>
    <Rail phase={phase} theme={theme} compact={compact} />
    <View style={{ flexDirection: compact ? "column" : "row", alignItems: compact ? "stretch" : "flex-start", gap: 12 }}>
      <CheckGroupPanel title="Plan sub-stages" entries={planChecks} checks={phase.checks.plan} theme={theme} compact={compact} split />
      <CheckGroupPanel title="Execute sub-stages" entries={executeChecks} checks={phase.checks.execute} theme={theme} compact={compact} split={false} />
    </View>
  </View>;
}
