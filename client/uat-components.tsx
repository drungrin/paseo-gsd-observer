import { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import type { BoardUatPhase, UatRecordSection, UatResultKind, UatTest } from "../shared/uat.js";
import type { BoardTheme, BoardViewState } from "./board-components.js";
import { BoardFrame, borderColor, Card, plural, smallStyle, textStyle, type ThemeProps } from "./board-frame.js";
import { PhaseHeading, PhasePicker } from "./core-components.js";
import { Legend, SegmentBar, Stat, surface, tint } from "./ui-kit.js";

type Severity = NonNullable<UatTest["severity"]>;
type RecordItem = UatRecordSection["items"][number];

const border = borderColor;
export const RESULT_LABELS: Record<UatResultKind, string> = { pass: "Pass", issue: "Issue", pending: "Pending", skipped: "Skipped", blocked: "Blocked", other: "Other" };
const SOURCE_LABELS = { automated: "Automated", human: "Human", evidence: "Evidence dossier", other: "Other", unrecorded: "Not recorded" } as const;

function resultColor(kind: UatResultKind, theme: BoardTheme): string {
  if (kind === "pass") return theme.colors.statusSuccess ?? theme.colors.accent;
  if (kind === "issue") return theme.colors.statusDanger ?? theme.colors.statusWarning ?? theme.colors.accent;
  if (kind === "blocked") return theme.colors.statusWarning ?? theme.colors.accent;
  return theme.colors.foregroundMuted;
}
const severityColor = (severity: Severity, theme: BoardTheme) => severity.level === "blocker" ? theme.colors.statusDanger ?? theme.colors.accent
  : severity.level === "major" ? theme.colors.statusWarning ?? theme.colors.accent : theme.colors.foregroundMuted;
const recordColor = (item: RecordItem, theme: BoardTheme) => item.statusKind === "open" ? theme.colors.statusWarning ?? theme.colors.accent
  : item.statusKind === "resolved" ? theme.colors.statusSuccess ?? theme.colors.accent : theme.colors.foregroundMuted;

/** Tests a person should read first: anything not passing, and anything with an issue history. */
const needsAttention = (test: UatTest) => test.history || test.result.kind !== "pass";
const judgedByPerson = (test: UatTest) => test.source.kind === "human" || test.source.kind === "evidence";

/** One short line per phase for the selector; UAT is per phase, so nothing is aggregated across phases. */
export function phaseSummary(phase: BoardUatPhase): { text: string; attention: boolean } {
  if (phase.observation === "unavailable") return { text: "Unreadable", attention: true };
  if (phase.observation === "not_observed") return { text: "No UAT", attention: false };
  const { results } = phase;
  // Only gaps speak for the phase (counted over every recorded entry); open observations stay visible in their own card.
  const open = phase.openGapCount;
  const parts = [
    phase.testCount ? `${results.pass}/${phase.testCount} pass` : "No tests recorded",
    results.issue ? plural(results.issue, "issue") : null,
    results.blocked ? `${results.blocked} blocked` : null,
    results.pending ? `${results.pending} pending` : null,
    open ? plural(open, "open gap") : null,
    phase.resolvedIssues ? plural(phase.resolvedIssues, "resolved issue") : null,
    phase.sources.human ? `${phase.sources.human} human` : null,
  ];
  const mismatch = (phase.summary?.mismatches.length ?? 0) > 0;
  return { text: parts.filter(Boolean).join(" · "), attention: results.issue + results.blocked + results.pending > 0 || open > 0 || mismatch };
}

/**
 * The current phase when it has a document (or one that could not be read, which must not be hidden); otherwise the
 * most recent earlier phase with one, since UAT and verification follow execution.
 */
export function defaultPhase(uat: { phases: readonly { id: string; current: boolean; observation: string }[] }): { id: string | undefined; fallback: boolean } {
  const currentIndex = uat.phases.findIndex((phase) => phase.current);
  const current = uat.phases[currentIndex];
  if (current && current.observation !== "not_observed") return { id: current.id, fallback: false };
  const earlier = uat.phases.slice(0, currentIndex < 0 ? uat.phases.length : currentIndex).reverse().find((phase) => phase.observation === "observed");
  const chosen = earlier ?? [...uat.phases].reverse().find((phase) => phase.observation === "observed");
  return chosen ? { id: chosen.id, fallback: !!current } : { id: current?.id ?? uat.phases[0]?.id, fallback: false };
}

function Badge({ label, color, theme }: { label: string; color: string; theme: BoardTheme }) {
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: tint(theme, color, 0.12) }}>
    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
    <Text style={{ ...smallStyle(theme, false), fontWeight: "600" }}>{label}</Text>
  </View>;
}

function Field({ label, value, theme }: { label: string; value: string | null; theme: BoardTheme }) {
  if (!value) return null;
  return <Text style={textStyle(theme, true)}><Text style={{ ...textStyle(theme), fontWeight: "600" }}>{label}: </Text>{value}</Text>;
}

function ShowToggle({ open, label, onPress, theme }: { open: boolean; label: string; onPress(): void; theme: BoardTheme }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${open ? "Hide" : "Show"} ${label}`} accessibilityState={{ expanded: open }} {...(Platform.OS === "web" ? { "aria-expanded": open } : {})} onPress={onPress} style={{ minHeight: 36, justifyContent: "center", alignSelf: "flex-start", paddingHorizontal: 14, borderRadius: 999, backgroundColor: surface(theme, 2) }}>
    <Text style={{ ...textStyle(theme), fontSize: 13, fontWeight: "500" }}>{open ? `Hide ${label}` : `Show ${label}`}</Text>
  </Pressable>;
}

function TestItem({ test, theme, compact, detailed }: { test: UatTest; theme: BoardTheme; compact: boolean; detailed: boolean }) {
  const result = test.result.label ?? RESULT_LABELS[test.result.kind];
  const badges = <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
    <Badge label={result.toLowerCase() === RESULT_LABELS[test.result.kind].toLowerCase() ? result : `${RESULT_LABELS[test.result.kind]} · ${result}`} color={resultColor(test.result.kind, theme)} theme={theme} />
    {test.severity && <Badge label={`Severity: ${test.severity.label ?? test.severity.level}`} color={severityColor(test.severity, theme)} theme={theme} />}
  </View>;
  // Not an accessible group: every visible field stays reachable to screen readers.
  return <View style={{ gap: 6, paddingTop: 10, borderTopWidth: 1, borderColor: border(theme) }}>
    <View style={{ flexDirection: compact ? "column" : "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
      <Text role="heading" style={{ ...textStyle(theme), fontWeight: "600", flex: compact ? undefined : 1, minWidth: 0 }}>{test.number !== null ? `${test.number}. ` : ""}{test.name ?? "Name withheld"}</Text>
      {badges}
    </View>
    {detailed && <>
      {test.expected ? <Field label="Expected" value={test.expected} theme={theme} /> : test.expectedSameAsName ? null : <Text style={smallStyle(theme)}>Expected behavior not shown.</Text>}
      {test.result.note && <Field label="Result" value={test.result.note} theme={theme} />}
      <Field label="Judged by" value={test.source.label ?? SOURCE_LABELS[test.source.kind]} theme={theme} />
      <Field label="Previously" value={test.previousResult} theme={theme} />
      <Field label="Reported" value={test.reported} theme={theme} />
      <Field label="Resolved by" value={test.resolvedBy} theme={theme} />
      <Field label="Reason" value={test.reason} theme={theme} />
      <Field label="Reference" value={test.reference} theme={theme} />
    </>}
  </View>;
}

function RecordCard({ section, theme }: { section: UatRecordSection; theme: BoardTheme }) {
  return <Card title={section.title} subtitle={`${plural(section.itemCount, "item")} recorded${section.items.length < section.itemCount ? ` · showing ${section.items.length}` : ""}`} theme={theme}>
    {section.items.map((item, index) => <View key={index} style={{ gap: 6, paddingTop: 10, borderTopWidth: index ? 1 : 0, borderColor: border(theme) }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
        {item.id && <Text style={{ ...textStyle(theme), fontWeight: "600" }}>{item.id}</Text>}
        {item.status && <Badge label={item.status.replace(/_/g, " ")} color={recordColor(item, theme)} theme={theme} />}
        {item.severity && <Badge label={`Severity: ${item.severity.label ?? item.severity.level}`} color={severityColor(item.severity, theme)} theme={theme} />}
        {item.test !== null && <Text style={smallStyle(theme)}>Test {item.test}</Text>}
        {item.date && <Text style={smallStyle(theme)}>{item.date}</Text>}
      </View>
      <Text style={textStyle(theme, !item.title)}>{item.title ?? "No description shown."}</Text>
      {item.conflicting && <Text role="alert" style={smallStyle(theme, false)}>This entry repeats a field with different values; repeated fields are not interpreted.</Text>}
      <Field label="Originally" value={item.originalStatus} theme={theme} />
      <Field label="Reason" value={item.reason} theme={theme} />
      <Field label="Root cause" value={item.rootCause} theme={theme} />
      <Field label="Resolved by" value={item.resolvedBy} theme={theme} />
      <Field label="Decision" value={item.decision} theme={theme} />
      {item.references > 0 && <Text style={smallStyle(theme)}>{plural(item.references, "file reference")} recorded; locations are not shown.</Text>}
    </View>)}
  </Card>;
}

const RESULT_ORDER = ["pass", "issue", "blocked", "pending", "skipped", "other"] as const;

/** Every recorded test of the phase as one bar, by result. */
function ResultBar({ phase, theme }: ThemeProps & { phase: BoardUatPhase }) {
  const present = RESULT_ORDER.filter((kind) => phase.results[kind] > 0);
  return <View style={{ gap: 8 }}>
    <SegmentBar theme={theme} height={14} label={present.map((kind) => `${phase.results[kind]} ${RESULT_LABELS[kind].toLowerCase()}`).join(", ") || "No tests"} segments={RESULT_ORDER.map((kind) => ({ label: kind, value: phase.results[kind], color: kind === "pending" ? tint(theme, theme.colors.foregroundMuted, 0.35) : resultColor(kind, theme) }))} />
    <Legend theme={theme} items={present.map((kind) => ({ color: kind === "pending" ? tint(theme, theme.colors.foregroundMuted, 0.35) : resultColor(kind, theme), label: `${phase.results[kind]} ${RESULT_LABELS[kind].toLowerCase()}` }))} />
  </View>;
}

function PhaseUat({ phase, theme, compact, testsOpen, sectionsOpen, onToggleTests, onToggleSections }: { phase: BoardUatPhase; theme: BoardTheme; compact: boolean; testsOpen: boolean; sectionsOpen: boolean; onToggleTests(): void; onToggleSections(): void }) {
  if (phase.observation !== "observed") return <Card title={`Phase ${phase.id} · ${phase.title}`} source="UAT.md" theme={theme} attention={phase.observation === "unavailable"}>
    <Text style={textStyle(theme, true)}>{phase.observation === "unavailable" ? "UAT.md could not be read safely for this phase." : "No UAT.md observed for this phase yet."}</Text>
  </Card>;
  const attention = phase.tests.filter(needsAttention);
  const human = phase.tests.filter((test) => !needsAttention(test) && judgedByPerson(test));
  const others = phase.tests.filter((test) => !needsAttention(test) && !judgedByPerson(test));
  const { results, sources, summary } = phase;
  const breakdown = (["issue", "blocked", "pending", "skipped", "other"] as const).filter((kind) => results[kind]).map((kind) => `${results[kind]} ${RESULT_LABELS[kind].toLowerCase()}`).join(" · ");
  const judged = (["automated", "human", "evidence", "other"] as const).filter((kind) => sources[kind]).map((kind) => `${sources[kind]} ${SOURCE_LABELS[kind].toLowerCase()}`).join(" · ");
  const current = phase.currentTest && phase.currentTest.state !== "complete" ? phase.currentTest : null;
  return <View style={{ gap: 16 }}>
    <PhaseHeading theme={theme} source="UAT.md" id={phase.id} title={phase.title} facts={["UAT.md observed", phase.startedAt ? `Started ${phase.startedAt}` : null, phase.updatedAt ? `Updated ${phase.updatedAt}` : null]} />
    {(JSON.stringify(phase).includes("[omitted]") || phase.excerptsLimited) && <View style={{ gap: 2 }}>
      {JSON.stringify(phase).includes("[omitted]") && <Text style={smallStyle(theme)}>Commands, absolute paths, links and host-like text are shown as [omitted].</Text>}
      {phase.excerptsLimited && <Text role="alert" style={smallStyle(theme)}>Some UAT text could not be safely extracted or was shortened.</Text>}
    </View>}
    {phase.testCount > 0 && <ResultBar phase={phase} theme={theme} />}
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
      <Stat theme={theme} size={18} label="Recorded status" value={phase.recordedStatus ?? "Not recorded"} detail={current ? `Current test: ${current.number !== null ? `${current.number} · ` : ""}${current.text ?? "recorded"}` : null} />
      <Stat theme={theme} size={18} label="Test results" value={phase.testCount ? `${results.pass} of ${phase.testCount} pass` : "No tests recorded"} detail={breakdown || (phase.testCount ? "Every recorded result is a pass." : null)} tone={results.issue + results.blocked ? "danger" : results.pending ? "warning" : phase.testCount && results.pass === phase.testCount ? "success" : undefined} />
      <Stat theme={theme} size={18} label="Judged by" value={judged || "Not recorded"} detail={sources.unrecorded ? `${sources.unrecorded} without a recorded source` : null} />
      <Stat theme={theme} size={18} label="Gaps" value={phase.gapCount ? `${phase.gapCount} recorded · ${phase.openGapCount} open` : "None recorded"} tone={phase.openGapCount > 0 ? "warning" : undefined} />
    </View>
    <View style={{ gap: 4 }}>
      {!summary ? <Text style={smallStyle(theme)}>No Summary section recorded.</Text>
        : summary.mismatches.length ? summary.mismatches.map((item) => <Text key={item.field} role="alert" style={smallStyle(theme, false)}>Summary records {item.recorded} {item.field}; the per-test results show {item.observed}.</Text>)
        : summary.compared ? <Text style={smallStyle(theme)}>Summary counts match the per-test results ({plural(summary.compared, "count")} compared).</Text>
        : <Text style={smallStyle(theme)}>The Summary records no counts that can be compared with the per-test results.</Text>}
      {summary && summary.ambiguous.length > 0 && <Text role="alert" style={smallStyle(theme, false)}>The Summary repeats {summary.ambiguous.join(", ")} with different entries; those counts are not compared.</Text>}
      {summary && summary.extras.length > 0 && <Text style={smallStyle(theme)}>Summary also records: {summary.extras.map((item) => `${item.label} ${item.count}`).join(", ")}.</Text>}
      {summary && summary.narrativeNotes > 0 && <Text style={smallStyle(theme)}>{plural(summary.narrativeNotes, "narrative note")} in the Summary {summary.narrativeNotes === 1 ? "is" : "are"} not interpreted; the per-test results above are what is recorded.</Text>}
      {phase.tests.length < phase.testCount && <Text style={smallStyle(theme)}>Showing {phase.tests.length} of {phase.testCount} tests within the excerpt limit; counts cover every test.</Text>}
    </View>
    <Card title="Human and evidence-dossier judgments" subtitle={human.length ? plural(human.length, "test") : undefined} theme={theme}>
      {human.length ? human.map((test, index) => <TestItem key={`${index}:${test.number}`} test={test} theme={theme} compact={compact} detailed />)
        : <Text style={textStyle(theme, true)}>No{attention.some(judgedByPerson) ? " other" : ""} test records a human or evidence-dossier source{attention.some(judgedByPerson) ? " outside the issue history below" : ""}.</Text>}
    </Card>
    <Card title="Issues and history" subtitle={attention.length ? plural(attention.length, "test") : undefined} theme={theme}>
      {attention.length ? attention.map((test, index) => <TestItem key={`${index}:${test.number}`} test={test} theme={theme} compact={compact} detailed />)
        : <Text style={textStyle(theme, true)}>No test records an issue, a non-passing result or an earlier report.</Text>}
    </Card>
    {phase.records.map((section, index) => <RecordCard key={index} section={section} theme={theme} />)}
    <Card title="Other tests" subtitle={others.length ? `${plural(others.length, "test")}${others.every((test) => test.result.kind === "pass") ? " · all pass" : ""}` : undefined} theme={theme}>
      {others.length ? <>
        <Text style={smallStyle(theme)}>Automated or unattributed checks with a passing result and no issue history.</Text>
        <ShowToggle open={testsOpen} label={`${plural(others.length, "test")} for phase ${phase.id}`} onPress={onToggleTests} theme={theme} />
        {testsOpen && others.map((test, index) => <TestItem key={`${index}:${test.number}`} test={test} theme={theme} compact={compact} detailed={false} />)}
      </> : <Text style={textStyle(theme, true)}>No other tests.</Text>}
    </Card>
    {phase.otherSections.length > 0 && <Card title="Other document sections" theme={theme}>
      <ShowToggle open={sectionsOpen} label={`other sections for phase ${phase.id}`} onPress={onToggleSections} theme={theme} />
      {sectionsOpen && <View style={{ gap: 12 }}>
        <Text style={smallStyle(theme)}>Short safe excerpts in source order; not the full UAT.md.</Text>
        {phase.otherSections.map((section) => <View key={section.title} style={{ gap: 4 }}><Text style={{ ...textStyle(theme), fontWeight: "600" }}>{section.title}</Text>
          {section.lines.length ? section.lines.map((line, index) => <Text key={index} style={textStyle(theme, true)}>{line}</Text>) : <Text style={smallStyle(theme)}>No safe excerpt available.</Text>}</View>)}
      </View>}
    </Card>}
  </View>;
}

/** The caveats behind the UAT tab. */
export const uatNotes = () => [
  "Results are recorded in the document; they are not a live test run.",
  "UAT is per phase, so nothing is aggregated across phases.",
];

export function UatView({ state, onRefresh, theme, compact = false }: ThemeProps & { state: BoardViewState; onRefresh(): void; compact?: boolean }) {
  const [selection, setSelection] = useState<{ workspaceId: string; phaseId: string } | null>(null);
  const [open, setOpen] = useState<{ workspaceId: string; keys: string[] }>({ workspaceId: "", keys: [] });
  const uat = state.snapshot?.overview?.uat;
  const fallback = uat ? defaultPhase(uat) : { id: undefined, fallback: false };
  const chosen = selection?.workspaceId === state.workspaceId && uat?.phases.some((phase) => phase.id === selection.phaseId) ? selection.phaseId : undefined;
  const selectedId = chosen ?? fallback.id;
  const selected = uat?.phases.find((phase) => phase.id === selectedId);
  const current = uat?.phases.find((phase) => phase.current);
  const isOpen = (key: string) => open.workspaceId === state.workspaceId && open.keys.includes(key);
  const toggle = (key: string) => setOpen({ workspaceId: state.workspaceId, keys: isOpen(key) ? open.keys.filter((item) => item !== key) : [...(open.workspaceId === state.workspaceId ? open.keys : []), key] });
  return <BoardFrame title="UAT" description="User acceptance testing recorded for each phase: what passed, what a person judged, and the issues found." subject="UAT" state={state} onRefresh={onRefresh} theme={theme} compact={compact}
    alerts={uat?.limited ? ["Some UAT evidence or safe excerpts may be incomplete."] : []} notes={uatNotes()}>
    {uat?.availability === "available" ? <>
      {uat.phases.length > 0 ? <>
        <PhasePicker label="UAT phases" selected={selectedId ?? null} onSelect={(id) => setSelection({ workspaceId: state.workspaceId, phaseId: id })} theme={theme} phases={uat.phases.map((phase) => {
          const summary = phaseSummary(phase);
          const observed = phase.observation === "observed";
          return { id: phase.id, current: phase.current, description: summary.text,
            tone: summary.attention ? phase.results.issue + phase.results.blocked > 0 ? "danger" : "warning" : observed && phase.testCount && phase.results.pass === phase.testCount ? "success" : null,
            detail: !observed ? summary.text.toLowerCase() : phase.testCount ? `${phase.results.pass}/${phase.testCount} pass` : "no tests",
            percent: observed && phase.testCount ? phase.results.pass / phase.testCount * 100 : undefined };
        })} />
        {!chosen && fallback.fallback && current?.observation === "not_observed" && selected && <Text style={smallStyle(theme)}>Phase {current.id} (current) has no UAT yet; showing Phase {selected.id}, the most recent phase with a UAT.</Text>}
        {selected && <PhaseUat phase={selected} theme={theme} compact={compact} testsOpen={isOpen(`${selected.id}:tests`)} sectionsOpen={isOpen(`${selected.id}:sections`)} onToggleTests={() => toggle(`${selected.id}:tests`)} onToggleSections={() => toggle(`${selected.id}:sections`)} />}
      </> : <Text style={textStyle(theme, true)}>No current-milestone phases declared in the roadmap.</Text>}
    </> : <Card title="UAT unavailable" theme={theme}><Text style={textStyle(theme, true)}>No readable current-milestone roadmap was found.</Text></Card>}
  </BoardFrame>;
}
