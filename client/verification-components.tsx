import { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import type { BoardUatPhase } from "../shared/uat.js";
import { VERIFICATION_ROW_KINDS, type BoardVerificationPhase, type VerificationCheckTable, type VerificationRowKind, type VerificationRowStatus, type VerificationTruthTable } from "../shared/verification.js";
import type { BoardTheme, BoardViewState } from "./board-components.js";
import { BoardFrame, borderColor, Card, plural, smallStyle, textStyle, type ThemeProps } from "./board-frame.js";
import { PhaseHeading, PhasePicker } from "./core-components.js";
import { defaultPhase } from "./uat-components.js";
import { Legend, SegmentBar, Stat, surface, tint, toneColor } from "./ui-kit.js";

type Counts = VerificationTruthTable["counts"];

const border = borderColor;
export const ROW_LABELS: Record<VerificationRowKind, string> = { verified: "Verified", failed: "Failed", partial: "Partial", unverified: "Behavior unverified", human: "Needs human", pending: "Pending", uncertain: "Uncertain", override: "Override", deferred: "Deferred", other: "Unclassified" };
/** Row states a reader should look at: anything recorded as neither verified, overridden, deferred nor unclassified. */
const ATTENTION_KINDS = ["failed", "partial", "unverified", "human", "pending", "uncertain"] as const satisfies readonly VerificationRowKind[];
const isAre = (count: number) => count === 1 ? "is" : "are";

function rowColor(kind: VerificationRowKind, theme: BoardTheme): string {
  if (kind === "verified" || kind === "override") return theme.colors.statusSuccess ?? theme.colors.accent;
  if (kind === "failed") return theme.colors.statusDanger ?? theme.colors.statusWarning ?? theme.colors.accent;
  if ((ATTENTION_KINDS as readonly string[]).includes(kind)) return theme.colors.statusWarning ?? theme.colors.accent;
  return theme.colors.foregroundMuted;
}

/** "1 failed · 2 behavior unverified" over the given kinds, in the fixed kind order. */
export function breakdown(counts: Counts, kinds: readonly VerificationRowKind[] = VERIFICATION_ROW_KINDS.filter((kind) => kind !== "verified")): string {
  return kinds.filter((kind) => counts[kind]).map((kind) => `${counts[kind]} ${ROW_LABELS[kind].toLowerCase()}`).join(" · ");
}

/** Recorded facts in the same report that disagree with each other; the report is not re-judged. */
export function disagreements(phase: BoardVerificationPhase): string[] {
  if (phase.observation !== "observed") return [];
  const notes: string[] = [];
  const truths = phase.truthTables[0];
  if (phase.bodyStatus) notes.push(`The report body still says ${phase.bodyStatus}; the header records ${phase.recordedStatus ?? "no status"}.`);
  if (phase.statusKind === "passed") {
    const { verified, total } = phase.score ?? { verified: null, total: null };
    if (verified !== null && total !== null && verified < total) notes.push(`Status is passed, but the score records ${verified} of ${total} verified.`);
    const open = truths ? breakdown(truths.counts, ATTENTION_KINDS) : "";
    if (open) notes.push(`Status is passed, but the truth table records ${open}.`);
    if (phase.openGapCount) notes.push(`Status is passed, but ${plural(phase.openGapCount, "gap")} ${isAre(phase.openGapCount)} not recorded as closed.`);
  }
  if (phase.behaviorUnverified !== null && truths && truths.counts.unverified !== phase.behaviorUnverified) notes.push(`The header records ${phase.behaviorUnverified} behavior-unverified; the truth table shows ${truths.counts.unverified}.`);
  if (phase.overridesApplied !== null && phase.overridesApplied !== phase.overrideCount) notes.push(`The header records ${phase.overridesApplied} overrides applied but lists ${plural(phase.overrideCount, "override")}.`);
  return notes;
}

/** One short line per phase for the selector; verification is per phase, so nothing is aggregated across phases. */
export function phaseSummary(phase: BoardVerificationPhase): { text: string; attention: boolean } {
  if (phase.observation === "unavailable") return { text: "Unreadable", attention: true };
  if (phase.observation === "not_observed") return { text: "No report", attention: false };
  const { verified, total } = phase.score ?? { verified: null, total: null };
  const parts = [
    phase.recordedStatus?.replace(/_/g, " ") ?? "No status",
    verified !== null && total !== null ? `${verified}/${total}` : null,
    phase.openGapCount ? plural(phase.openGapCount, "open gap") : null,
    phase.openHumanCount ? plural(phase.openHumanCount, "human check") : null,
    phase.behaviorCount ? `${phase.behaviorCount} behavior unverified` : null,
  ];
  const attention = phase.statusKind !== "passed" || phase.openGapCount + phase.openHumanCount + phase.behaviorCount + (phase.truthTables[0]?.counts.other ?? 0) > 0 || disagreements(phase).length > 0;
  return { text: parts.filter(Boolean).join(" · "), attention };
}

function Badge({ label, color, theme }: { label: string; color: string; theme: BoardTheme }) {
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: tint(theme, color, 0.12) }}>
    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
    <Text style={{ ...smallStyle(theme, false), fontWeight: "600" }}>{label}</Text>
  </View>;
}

/** The recorded wording, prefixed with the kind when the wording does not already name it ("Failed · ✗ NOT WIRED"). */
export function statusLabel(status: NonNullable<VerificationRowStatus>): string {
  const kind = ROW_LABELS[status.kind];
  if (!status.label) return kind;
  const words = status.label.toLowerCase().replace(/_/g, " ");
  return words.includes(kind.toLowerCase().split(" ")[0]) ? status.label : `${kind} · ${status.label}`;
}

function StatusBadge({ status, theme }: { status: VerificationRowStatus; theme: BoardTheme }) {
  if (!status) return <Badge label="No status recorded" color={theme.colors.foregroundMuted} theme={theme} />;
  return <Badge label={statusLabel(status)} color={rowColor(status.kind, theme)} theme={theme} />;
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

const barColor = (kind: VerificationRowKind, theme: BoardTheme) => kind === "pending" || kind === "deferred" || kind === "other" ? tint(theme, theme.colors.foregroundMuted, 0.35) : kind === "override" ? tint(theme, toneColor(theme, "success"), 0.5) : rowColor(kind, theme);

/** A truth table's rows as one bar, by recorded state. */
function TruthBar({ counts, theme }: ThemeProps & { counts: Counts }) {
  const present = VERIFICATION_ROW_KINDS.filter((kind) => counts[kind] > 0);
  return <View style={{ gap: 8 }}>
    <SegmentBar theme={theme} height={12} label={present.map((kind) => `${counts[kind]} ${ROW_LABELS[kind].toLowerCase()}`).join(", ") || "No rows"} segments={VERIFICATION_ROW_KINDS.map((kind) => ({ label: kind, value: counts[kind], color: barColor(kind, theme) }))} />
    <Legend theme={theme} items={present.map((kind) => ({ color: barColor(kind, theme), label: `${counts[kind]} ${ROW_LABELS[kind].toLowerCase()}` }))} />
  </View>;
}

function Entry({ first, children, theme }: { first: boolean; children: React.ReactNode; theme: BoardTheme }) {
  // Not an accessible group: every visible field stays reachable to screen readers.
  return <View style={{ gap: 6, paddingTop: first ? 0 : 10, borderTopWidth: first ? 0 : 1, borderColor: border(theme) }}>{children}</View>;
}

function TruthItem({ row, textLabel, first, showEvidence, theme, compact }: { row: VerificationTruthTable["rows"][number]; textLabel: string | null; first: boolean; showEvidence: boolean; theme: BoardTheme; compact: boolean }) {
  const numbered = row.key !== null && /^\d{1,4}$/.test(row.key);
  // A bare count ("4/4") only reads with its column name ("Declared truths: 4/4").
  const counted = !!row.text && !!textLabel && /^\d+(?:\s*\/\s*\d+)?$/.test(row.text);
  return <Entry first={first} theme={theme}>
    {row.key && !numbered && <Text style={smallStyle(theme)}>{row.key}</Text>}
    <View style={{ flexDirection: compact ? "column" : "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
      <Text style={{ ...textStyle(theme, !row.text), flex: compact ? undefined : 1, minWidth: 0 }}>{numbered ? `${row.key}. ` : ""}{counted ? `${textLabel}: ` : ""}{row.text ?? "Truth text not shown."}</Text>
      {row.aligned ? <StatusBadge status={row.status} theme={theme} /> : <Badge label="Status not read" color={theme.colors.statusWarning ?? theme.colors.accent} theme={theme} />}
    </View>
    {!row.aligned && <Text style={smallStyle(theme)}>This row's cells do not line up with the table header, so its status is not read.</Text>}
    {row.status?.note && <Text style={smallStyle(theme)}>{row.status.note}</Text>}
    {showEvidence && <Field label="Evidence" value={row.evidence} theme={theme} />}
  </Entry>;
}

const truthCountsText = (table: VerificationTruthTable) => `${table.counts.verified} of ${table.rowCount} verified${breakdown(table.counts) ? ` · ${breakdown(table.counts)}` : ""}`;

function TruthCard({ table, phaseId, theme, compact, open, onToggle, primary }: { table: VerificationTruthTable; phaseId: string; theme: BoardTheme; compact: boolean; open: boolean; onToggle(): void; primary: boolean }) {
  const needsReading = (row: VerificationTruthTable["rows"][number]) => row.status?.kind !== "verified";
  const verified = table.rows.filter((row) => !needsReading(row));
  const withheldRows = table.rowCount - table.rows.length;
  // The phase's own truths are always listed; further tables (plan must-haves) stay collapsed.
  const rows = primary || open ? table.rows : table.rows.filter(needsReading);
  return <Card title={table.title} subtitle={truthCountsText(table)} theme={theme}>
    {table.rowCount > 0 && <TruthBar counts={table.counts} theme={theme} />}
    {withheldRows > 0 && <Text style={smallStyle(theme)}>Showing {table.rows.length} of {table.rowCount} rows within the excerpt limit; counts cover every row.</Text>}
    {rows.map((row, index) => <TruthItem key={index} row={row} textLabel={table.textLabel} first={index === 0} showEvidence={needsReading(row) || open} theme={theme} compact={compact} />)}
    {(primary ? verified.some((row) => row.evidence) : verified.length > 0) && <ShowToggle open={open} label={primary ? `evidence for ${plural(verified.length, "verified truth")} in phase ${phaseId}` : `${plural(verified.length, "verified row")} in ${table.title}`} onPress={onToggle} theme={theme} />}
  </Card>;
}

function checkSummary(check: VerificationCheckTable): string {
  const parts: string[] = [];
  if (check.statusRecorded) parts.push(`${check.counts.verified + check.counts.override} of ${plural(check.rowCount, "row")} verified`, breakdown(check.counts, VERIFICATION_ROW_KINDS.filter((kind) => kind !== "verified" && kind !== "override")));
  else parts.push(plural(check.rowCount, "finding"));
  if (check.severities) parts.push((["blocker", "warning", "info", "other"] as const).filter((level) => check.severities?.[level]).map((level) => plural(check.severities![level], level === "other" ? "other severity" : level, level === "other" ? "other severities" : undefined)).join(" · "));
  return parts.filter(Boolean).join(" · ");
}

// Rows needing attention: anything not recorded as verified when a status is recorded, otherwise blocker or warning severity.
const attentionRows = (check: VerificationCheckTable) => check.statusRecorded ? check.rowCount - check.counts.verified - check.counts.override
  : (check.severities?.blocker ?? 0) + (check.severities?.warning ?? 0);

function CheckBlock({ check, first, theme, open, onToggle }: { check: VerificationCheckTable; first: boolean; theme: BoardTheme; open: boolean; onToggle(): void }) {
  const listedAll = check.listed === "all";
  return <Entry first={first} theme={theme}>
    <Text style={{ ...textStyle(theme), fontWeight: "600" }}>{check.title}</Text>
    <Text style={smallStyle(theme)}>{checkSummary(check)}</Text>
    {listedAll && check.rows.length > 0 && <ShowToggle open={open} label={`${plural(check.rows.length, "row")} in ${check.title}`} onPress={onToggle} theme={theme} />}
    {listedAll && open && check.rows.length < check.rowCount && <Text style={smallStyle(theme)}>Showing {check.rows.length} of {check.rowCount} rows within the excerpt limit; rows needing attention come first.</Text>}
    {(!listedAll || open) && check.rows.map((row, index) => <View key={index} style={{ gap: 4, paddingLeft: 12, borderLeftWidth: 2, borderColor: border(theme) }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
        <Text style={textStyle(theme, !row.key)}>{row.key ?? "Row name not shown."}</Text>
        {row.status && <StatusBadge status={row.status} theme={theme} />}
        {!row.aligned && <Badge label="Status not read" color={theme.colors.statusWarning ?? theme.colors.accent} theme={theme} />}
        {row.severity && <Badge label={`Severity: ${row.severity}`} color={row.severity === "blocker" ? theme.colors.statusDanger ?? theme.colors.accent : row.severity === "warning" ? theme.colors.statusWarning ?? theme.colors.accent : theme.colors.foregroundMuted} theme={theme} />}
      </View>
      {!row.aligned && <Text style={smallStyle(theme)}>This row's cells do not line up with the table header, so its status is not read.</Text>}
      {row.status?.note && <Text style={smallStyle(theme)}>{row.status.note}</Text>}
      <Field label="Detail" value={row.detail} theme={theme} />
    </View>)}
    {!listedAll && check.rows.length < Math.min(attentionRows(check), check.rowCount) && <Text style={smallStyle(theme)}>Some rows needing attention are not shown within the excerpt limit.</Text>}
  </Entry>;
}

function PhaseVerification({ phase, uat, theme, compact, isOpen, onToggle }: { phase: BoardVerificationPhase; uat: BoardUatPhase | undefined; theme: BoardTheme; compact: boolean; isOpen(key: string): boolean; onToggle(key: string): void }) {
  if (phase.observation !== "observed") return <Card title={`Phase ${phase.id} · ${phase.title}`} source="VERIFICATION.md" theme={theme} attention={phase.observation === "unavailable"}>
    <Text style={textStyle(theme, true)}>{phase.observation === "unavailable" ? "VERIFICATION.md could not be read safely for this phase." : "No VERIFICATION.md observed for this phase yet."}</Text>
  </Card>;
  const key = (name: string) => `${phase.id}:${name}`;
  const [truths, ...moreTruths] = phase.truthTables;
  const notes = disagreements(phase);
  const { verified, total, text: scoreText } = phase.score ?? { verified: null, total: null, text: null };
  const again = phase.reVerification;
  const also = [
    phase.decisionCoverage && `Decision coverage: ${phase.decisionCoverage.honored ?? "?"} of ${phase.decisionCoverage.total ?? "?"} honored${phase.decisionCoverage.notHonored ? ` · ${phase.decisionCoverage.notHonored} not honored` : ""}.`,
    phase.deferredCount ? `${plural(phase.deferredCount, "deferred item")} recorded in the header.` : null,
    phase.coincidentalCount ? `${plural(phase.coincidentalCount, "truth")} recorded as holding by coincidental reliance.` : null,
    phase.otherFields.length ? `Other header fields, not interpreted: ${phase.otherFields.join(", ")}.` : null,
  ].filter((line): line is string => !!line);
  return <View style={{ gap: 16 }}>
    <PhaseHeading theme={theme} source="VERIFICATION.md" id={phase.id} title={phase.title} facts={["VERIFICATION.md observed", phase.verifiedAt ? `Verified ${phase.verifiedAt}` : null, phase.disposedAt ? `Disposed ${phase.disposedAt}` : null]} />
    {(JSON.stringify(phase).includes("[omitted]") || phase.excerptsLimited) && <View style={{ gap: 2 }}>
      {JSON.stringify(phase).includes("[omitted]") && <Text style={smallStyle(theme)}>Commands, absolute paths, links and host-like text are shown as [omitted].</Text>}
      {phase.excerptsLimited && <Text role="alert" style={smallStyle(theme)}>Some verification text could not be safely extracted or was shortened.</Text>}
    </View>}
    {verified !== null && total !== null && total > 0 && <SegmentBar theme={theme} height={14} label={`${verified} of ${total} verified`} segments={[
      { label: "verified", value: verified, color: toneColor(theme, "success") }, { label: "not verified", value: total - verified, color: toneColor(theme, "warning") },
    ]} />}
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
      <Stat theme={theme} size={18} label="Recorded status" value={phase.recordedStatus ?? "Not recorded"} detail={again ? `Re-verified; previously ${again.previousStatus ?? "not recorded"}${again.previousScore ? ` (${again.previousScore})` : ""}` : null} tone={phase.statusKind === "passed" ? "success" : phase.statusKind === "gaps_found" ? "danger" : "warning"} />
      <Stat theme={theme} size={18} label="Score" value={verified !== null && total !== null ? `${verified} of ${total} verified` : scoreText ?? "Not recorded"} detail={verified !== null ? scoreText : null} tone={verified !== null && total !== null && verified < total ? "warning" : undefined} />
      <Stat theme={theme} size={18} label="Truths" value={truths ? `${truths.counts.verified} of ${truths.rowCount} verified` : "No truth table found"} detail={truths ? `${breakdown(truths.counts) || "Every row is recorded as verified"} (${truths.title}).` : null} tone={!!truths && ATTENTION_KINDS.some((kind) => truths.counts[kind] > 0) ? "warning" : undefined} />
      <Stat theme={theme} size={18} label="Gaps" value={phase.gapCount ? `${phase.gapCount} recorded · ${phase.openGapCount} open` : "None recorded"} tone={phase.openGapCount > 0 ? "danger" : undefined} />
      <Stat theme={theme} size={18} label="Human checks" value={phase.humanCount ? `${phase.humanCount} recorded · ${phase.openHumanCount} unresolved` : "None recorded"} detail={[phase.humanClosed ? `Closed${phase.humanClosed.date ? ` ${phase.humanClosed.date}` : ""}` : null, phase.recordedHumanCount ? `${phase.recordedHumanCount} with an unclassified outcome` : null].filter(Boolean).join(" · ") || null} tone={phase.openHumanCount > 0 ? "warning" : undefined} />
    </View>
    {notes.length > 0 && <View style={{ gap: 4 }}>{notes.map((note) => <Text key={note} role="alert" style={{ ...smallStyle(theme, false), color: toneColor(theme, "warning") }}>{note}</Text>)}</View>}
    {!!truths?.counts.other && <Text style={smallStyle(theme, false)}>{plural(truths.counts.other, "truth row")} {isAre(truths.counts.other)} recorded with wording this tab does not classify; read {truths.counts.other === 1 ? "it" : "them"} below.</Text>}

    {(phase.gapCount > 0 || phase.gapsSummary) && <Card title="Gaps" subtitle={phase.gapCount ? `${plural(phase.gapCount, "gap")} recorded · ${phase.openGapCount} open${phase.gaps.length < phase.gapCount ? ` · showing ${phase.gaps.length}` : ""}` : "None recorded in the header"} theme={theme}>
      {phase.gaps.map((gap, index) => <Entry key={index} first={index === 0} theme={theme}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
          {gap.status && <Badge label={gap.status.replace(/_/g, " ")} color={gap.statusKind === "closed" ? theme.colors.statusSuccess ?? theme.colors.accent : gap.statusKind === "open" || gap.statusKind === "partial" || gap.statusKind === null ? theme.colors.statusWarning ?? theme.colors.accent : theme.colors.foregroundMuted} theme={theme} />}
          {gap.closedAt && <Text style={smallStyle(theme)}>Closed {gap.closedAt}</Text>}
        </View>
        <Text style={textStyle(theme, !gap.truth)}>{gap.truth ?? "Gap description not shown."}</Text>
        {gap.conflicting && <Text role="alert" style={smallStyle(theme, false)}>This gap repeats a field with different values; repeated fields are not interpreted.</Text>}
        <Field label="Previously" value={gap.previousStatus} theme={theme} />
        <Field label="Reason" value={gap.reason} theme={theme} />
        <Field label="Closed by" value={gap.closedBy} theme={theme} />
        {gap.missing + gap.artifacts > 0 && <Text style={smallStyle(theme)}>{[gap.missing ? plural(gap.missing, "missing item") : null, gap.artifacts ? `${plural(gap.artifacts, "artifact")} (locations not shown)` : null].filter(Boolean).join(" · ")} recorded.</Text>}
      </Entry>)}
      {phase.gapsSummary && <Field label="Gaps summary, as written" value={phase.gapsSummary} theme={theme} />}
    </Card>}

    {phase.behaviorCount > 0 && <Card title="Behavior not exercised by a test" subtitle={`${plural(phase.behaviorCount, "truth")}: present and wired, but no test exercised the behavior`} theme={theme}>
      {phase.behaviorItems.map((item, index) => <Entry key={index} first={index === 0} theme={theme}>
        <Text style={{ ...textStyle(theme, !item.truth), fontWeight: "600" }}>{item.truth ?? "Truth text not shown."}</Text>
        <Field label="Test" value={item.test} theme={theme} />
        <Field label="Expected" value={item.expected} theme={theme} />
        <Field label="Why human" value={item.whyHuman} theme={theme} />
      </Entry>)}
    </Card>}

    <Card title="Human verification" subtitle={phase.humanCount ? `${plural(phase.humanCount, "check")} recorded · ${phase.openHumanCount} unresolved${phase.recordedHumanCount ? ` · ${phase.recordedHumanCount} with an outcome this tab does not classify` : ""}` : undefined} theme={theme}>
      {phase.humanClosed && <Text style={textStyle(theme, true)}>Recorded as closed{phase.humanClosed.date ? ` on ${phase.humanClosed.date}` : ""}{phase.humanClosed.by ? ` by: ${phase.humanClosed.by}` : "."}</Text>}
      {phase.humanChecks.map((check, index) => <Entry key={index} first={index === 0 && !phase.humanClosed} theme={theme}>
        <View style={{ flexDirection: compact ? "column" : "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
          <Text style={{ ...textStyle(theme, !check.test), fontWeight: "600", flex: compact ? undefined : 1, minWidth: 0 }}>{check.test ?? "Check description not shown."}</Text>
          <Badge label={check.state === "resolved" ? `Resolved${check.resolvedAt ? ` ${check.resolvedAt}` : ""}` : check.state === "recorded" ? "Outcome recorded" : check.resolution ? "Not resolved" : "No resolution recorded"}
            color={check.state === "resolved" ? theme.colors.statusSuccess ?? theme.colors.accent : check.state === "recorded" ? theme.colors.foregroundMuted : theme.colors.statusWarning ?? theme.colors.accent} theme={theme} />
        </View>
        <Field label="Expected" value={check.expected} theme={theme} />
        <Field label="Why human" value={check.whyHuman} theme={theme} />
        <Field label="Resolution" value={check.resolution} theme={theme} />
      </Entry>)}
      {phase.humanChecks.length < phase.humanCount && <Text style={smallStyle(theme)}>Showing {phase.humanChecks.length} of {phase.humanCount} checks within the excerpt limit.</Text>}
      {!phase.humanCount && <Text style={textStyle(theme, true)}>{phase.humanNote ? `The report says: ${phase.humanNote}` : "The header records no human verification."}</Text>}
      {uat?.observation === "observed" && <Text style={smallStyle(theme)}>This phase's UAT.md records {uat.results.pass} of {uat.testCount} tests passing; see the UAT tab.</Text>}
    </Card>

    {truths ? <TruthCard table={truths} phaseId={phase.id} theme={theme} compact={compact} open={isOpen(key("evidence"))} onToggle={() => onToggle(key("evidence"))} primary />
      : <Card title="Observable truths" theme={theme}><Text style={textStyle(theme, true)}>No truth table with a recorded status was found in the report.</Text></Card>}
    {moreTruths.map((table, index) => <TruthCard key={index} table={table} phaseId={phase.id} theme={theme} compact={compact} open={isOpen(key(`truths:${index}`))} onToggle={() => onToggle(key(`truths:${index}`))} primary={false} />)}

    {phase.checks.length > 0 && <Card title="Supporting checks" subtitle="Counts cover every row; only rows needing attention are listed, except requirement and decision IDs." theme={theme}>
      {phase.checks.map((check, index) => <CheckBlock key={index} check={check} first={index === 0} theme={theme} open={isOpen(key(`check:${index}`))} onToggle={() => onToggle(key(`check:${index}`))} />)}
    </Card>}

    {phase.overrideCount > 0 && <Card title="Overrides" subtitle={`${plural(phase.overrideCount, "must-have")} accepted by override`} theme={theme}>
      {phase.overrides.map((item, index) => <Entry key={index} first={index === 0} theme={theme}>
        <Text style={textStyle(theme, !item.mustHave)}>{item.mustHave ?? "Must-have text not shown."}</Text>
        <Field label="Reason" value={item.reason} theme={theme} />
        <Field label="Accepted" value={item.acceptedAt} theme={theme} />
      </Entry>)}
    </Card>}

    {again && <Card title="Re-verification" subtitle={`${plural(again.gapsClosed, "gap")} closed · ${again.gapsRemaining} remaining · ${plural(again.regressions, "regression")}`} theme={theme}>
      <Text style={textStyle(theme, true)}>Previously {again.previousStatus ?? "not recorded"}{again.previousScore ? ` (${again.previousScore})` : ""}. As recorded at re-verification; later sections may update it.</Text>
      {again.regressionItems.map((item, index) => <Field key={`r${index}`} label="Regression" value={item} theme={theme} />)}
      {again.remaining.map((item, index) => <Field key={`g${index}`} label="Remaining" value={item} theme={theme} />)}
    </Card>}

    {phase.laterSections.length > 0 && <Card title="Later dated sections" subtitle="Written after the tables above; they may revise what those tables record." theme={theme}>
      {phase.laterSections.map((section, index) => <Entry key={index} first={index === 0} theme={theme}>
        <Text style={{ ...textStyle(theme), fontWeight: "600" }}>{section.title}</Text>
        {section.lines.map((line, lineIndex) => <Text key={lineIndex} style={textStyle(theme, true)}>{line}</Text>)}
        {section.tables > 0 && <Text style={smallStyle(theme)}>{plural(section.tables, "table")} in this section {section.tables === 1 ? "is" : "are"} not interpreted.</Text>}
      </Entry>)}
    </Card>}

    {also.length > 0 && <Card title="Also recorded" theme={theme}>{also.map((line) => <Text key={line} style={textStyle(theme, true)}>{line}</Text>)}</Card>}

    {phase.otherSections.length > 0 && <Card title="Other document sections" theme={theme}>
      <ShowToggle open={isOpen(key("sections"))} label={`other sections for phase ${phase.id}`} onPress={() => onToggle(key("sections"))} theme={theme} />
      {isOpen(key("sections")) && <View style={{ gap: 12 }}>
        <Text style={smallStyle(theme)}>Short safe excerpts in source order; not the full VERIFICATION.md.</Text>
        {phase.otherSections.map((section, index) => <View key={index} style={{ gap: 4 }}><Text style={{ ...textStyle(theme), fontWeight: "600" }}>{section.title}</Text>
          {section.lines.length ? section.lines.map((line, lineIndex) => <Text key={lineIndex} style={textStyle(theme, true)}>{line}</Text>) : <Text style={smallStyle(theme)}>No safe excerpt available.</Text>}</View>)}
      </View>}
    </Card>}
  </View>;
}

/** The caveats behind the verification tab. */
export const verificationNotes = () => [
  "Results are recorded in the report; they are not a live check.",
  "Verification is per phase, so nothing is aggregated across phases. Disagreements are facts of the same report that do not match; the report is not re-judged.",
];

export function VerificationView({ state, onRefresh, theme, compact = false }: ThemeProps & { state: BoardViewState; onRefresh(): void; compact?: boolean }) {
  const [selection, setSelection] = useState<{ workspaceId: string; phaseId: string } | null>(null);
  const [open, setOpen] = useState<{ workspaceId: string; keys: string[] }>({ workspaceId: "", keys: [] });
  const verification = state.snapshot?.overview?.verification;
  const fallback = verification ? defaultPhase(verification) : { id: undefined, fallback: false };
  const chosen = selection?.workspaceId === state.workspaceId && verification?.phases.some((phase) => phase.id === selection.phaseId) ? selection.phaseId : undefined;
  const selectedId = chosen ?? fallback.id;
  const selected = verification?.phases.find((phase) => phase.id === selectedId);
  const current = verification?.phases.find((phase) => phase.current);
  const isOpen = (key: string) => open.workspaceId === state.workspaceId && open.keys.includes(key);
  const toggle = (key: string) => setOpen({ workspaceId: state.workspaceId, keys: isOpen(key) ? open.keys.filter((item) => item !== key) : [...(open.workspaceId === state.workspaceId ? open.keys : []), key] });
  return <BoardFrame title="Verification" description="Goal-backward verification recorded for each phase: score, truths, gaps and human checks." subject="verification" state={state} onRefresh={onRefresh} theme={theme} compact={compact}
    alerts={verification?.limited ? ["Some verification evidence or safe excerpts may be incomplete."] : []} notes={verificationNotes()}>
    {verification?.availability === "available" ? <>
      {verification.phases.length > 0 ? <>
        <PhasePicker label="Verification phases" selected={selectedId ?? null} onSelect={(id) => setSelection({ workspaceId: state.workspaceId, phaseId: id })} theme={theme} phases={verification.phases.map((phase) => {
          const summary = phaseSummary(phase);
          const { verified, total } = phase.score ?? { verified: null, total: null };
          const observed = phase.observation === "observed";
          return { id: phase.id, current: phase.current, description: summary.text,
            tone: summary.attention ? phase.statusKind === "gaps_found" || phase.openGapCount > 0 ? "danger" : "warning" : observed ? "success" : null,
            detail: !observed ? summary.text.toLowerCase() : verified !== null && total !== null ? `${verified}/${total}` : phase.recordedStatus?.replace(/_/g, " ") ?? "no status",
            percent: observed && verified !== null && total ? verified / total * 100 : undefined };
        })} />
        {!chosen && fallback.fallback && current?.observation === "not_observed" && selected && <Text style={smallStyle(theme)}>Phase {current.id} (current) has no verification report yet; showing Phase {selected.id}, the most recent phase with one.</Text>}
        {selected && <PhaseVerification phase={selected} uat={state.snapshot?.overview?.uat?.phases.find((phase) => phase.id === selected.id)} theme={theme} compact={compact} isOpen={isOpen} onToggle={toggle} />}
      </> : <Text style={textStyle(theme, true)}>No current-milestone phases declared in the roadmap.</Text>}
    </> : <Card title="Verification unavailable" theme={theme}><Text style={textStyle(theme, true)}>No readable current-milestone roadmap was found.</Text></Card>}
  </BoardFrame>;
}
