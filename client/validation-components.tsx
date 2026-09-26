import { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import { VALIDATION_STATUS_KINDS, type BoardValidationPhase, type ValidationStatusKind, type ValidationTable } from "../shared/validation.js";
import type { BoardTheme, BoardViewState } from "./board-components.js";

type Checklist = NonNullable<BoardValidationPhase["signOff"]>;
type Audit = BoardValidationPhase["audits"][number];

const textStyle = (theme: BoardTheme, muted = false) => ({ color: muted ? theme.colors.foregroundMuted : theme.colors.foreground, fontSize: 14, lineHeight: 21, flexShrink: 1 });
const smallStyle = (theme: BoardTheme, muted = true) => ({ ...textStyle(theme, muted), fontSize: 12, lineHeight: 18 });
const border = (theme: BoardTheme) => theme.colors.border ?? theme.colors.foregroundMuted;
export const STATUS_KIND_LABELS: Record<ValidationStatusKind, string> = { passing: "Passing", pending: "Pending", failing: "Failing", partial: "Partial", human: "Needs human", blocked: "Blocked", flaky: "Flaky", other: "Other" };

function kindColor(kind: ValidationStatusKind, theme: BoardTheme): string {
  if (kind === "passing") return theme.colors.statusSuccess ?? theme.colors.accent;
  if (kind === "failing") return theme.colors.statusDanger ?? theme.colors.statusWarning ?? theme.colors.accent;
  if (kind === "partial" || kind === "human" || kind === "blocked" || kind === "flaky") return theme.colors.statusWarning ?? theme.colors.accent;
  return theme.colors.foregroundMuted;
}

/** The latest audit by recorded date; undated audits only count when nothing is dated, in document order. */
export function latestAudit(audits: readonly Audit[]): Audit | null {
  const dated = audits.filter((audit) => audit.date);
  if (dated.length) return dated.reduce((latest, audit) => audit.date! >= latest.date! ? audit : latest);
  return audits.at(-1) ?? null;
}

const auditMetrics = (audit: Audit) => audit.gaps === null && audit.resolved === null && audit.escalated === null ? "No gap counts recorded"
  : [audit.gaps === null ? null : `${audit.gaps} ${audit.gaps === 1 ? "gap" : "gaps"} found`, audit.resolved === null ? null : `${audit.resolved} resolved`, audit.escalated === null ? null : `${audit.escalated} escalated`].filter(Boolean).join(" · ");
const yesNo = (value: boolean | null) => value === null ? "Not recorded" : value ? "Yes" : "No";

/** One short line for the phase selector; compliance and open audit gaps are never folded into the recorded status. */
export function phaseSummary(phase: BoardValidationPhase): { text: string; attention: boolean } {
  if (phase.observation === "unavailable") return { text: "Unreadable", attention: false };
  if (phase.observation === "not_observed") return { text: "No file", attention: false };
  const audit = latestAudit(phase.audits);
  // Only the primary verification table speaks for the phase; later tables may be historical audit or execution records.
  const failing = (phase.tables.find((table) => table.role === "verification")?.counts?.failing ?? 0) > 0;
  const parts = [phase.recordedStatus ?? "Status not recorded", phase.nyquistCompliant === false ? "not compliant" : null, audit?.escalated ? "audit escalations" : null, failing ? "failing rows" : null];
  return { text: parts.filter(Boolean).join(" · "), attention: phase.nyquistCompliant === false || !!audit?.escalated || failing };
}

function Card({ title, subtitle, children, theme }: { title: string; subtitle?: string; children: React.ReactNode; theme: BoardTheme }) {
  return <View style={{ minWidth: 0, padding: 16, gap: 10, borderRadius: 10, borderWidth: 1, borderColor: border(theme), backgroundColor: theme.colors.surface1 ?? theme.colors.surface0 }}>
    <View style={{ gap: 2 }}><Text role="heading" style={{ ...textStyle(theme), fontSize: 16, fontWeight: "600" }}>{title}</Text>{subtitle && <Text style={smallStyle(theme)}>{subtitle}</Text>}</View>
    {children}
  </View>;
}

function Dot({ kind, theme }: { kind: ValidationStatusKind; theme: BoardTheme }) {
  return <View style={{ width: 9, height: 9, borderRadius: 5, marginTop: 6, backgroundColor: kindColor(kind, theme) }} />;
}

function StatusCell({ status, theme }: { status: NonNullable<ValidationTable["rows"][number]["status"]>; theme: BoardTheme }) {
  return <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 7, minWidth: 0 }}>
    <Dot kind={status.kind} theme={theme} />
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text style={{ ...textStyle(theme), fontSize: 13, fontWeight: "600" }}>{status.label ?? STATUS_KIND_LABELS[status.kind]}</Text>
      {status.label && status.label.toLowerCase() !== STATUS_KIND_LABELS[status.kind].toLowerCase() && <Text style={smallStyle(theme)}>{STATUS_KIND_LABELS[status.kind]}</Text>}
      {status.note && <Text style={smallStyle(theme)}>{status.note}</Text>}
    </View>
  </View>;
}

function Cell({ value, theme }: { value: string | null; theme: BoardTheme }) {
  if (value === null) return <Text style={{ ...smallStyle(theme), fontStyle: "italic" }}>Withheld</Text>;
  return <Text style={{ ...textStyle(theme, !value), fontSize: 13, lineHeight: 19 }}>{value || "—"}</Text>;
}

function StatusCounts({ counts, theme }: { counts: NonNullable<ValidationTable["counts"]>; theme: BoardTheme }) {
  const present = VALIDATION_STATUS_KINDS.filter((kind) => counts[kind] > 0);
  return <View accessibilityLabel={present.map((kind) => `${STATUS_KIND_LABELS[kind]} ${counts[kind]}`).join(", ") || "No rows"} style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
    {present.map((kind) => <View key={kind} style={{ flexDirection: "row", alignItems: "flex-start", gap: 7, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: border(theme) }}>
      <Dot kind={kind} theme={theme} /><Text style={{ ...textStyle(theme), fontSize: 13 }}>{STATUS_KIND_LABELS[kind]} {counts[kind]}</Text>
    </View>)}
  </View>;
}

const tableSubtitle = (table: ValidationTable) => [
  `${table.rowCount} ${table.rowCount === 1 ? "row" : "rows"} recorded`,
  table.rows.length < table.rowCount ? `showing ${table.rows.length}` : null,
  table.irregularRows ? `${table.irregularRows} with irregular columns` : null,
].filter(Boolean).join(" · ");

function columnWidth(table: ValidationTable, index: number): number {
  const longest = Math.max(table.columns[index].length, ...table.rows.map((row) => row.cells[index]?.length ?? 8));
  return Math.min(300, Math.max(84, Math.round(longest * 7.2)));
}

/** Status is pinned after the row key so it stays visible when the file's own columns scroll horizontally. */
function WideTable({ table, theme }: { table: ValidationTable; theme: BoardTheme }) {
  const widths = table.columns.map((_, index) => columnWidth(table, index));
  const keyWidth = Math.min(220, Math.max(96, Math.round(Math.max(table.keyLabel.length, ...table.rows.map((row) => row.key?.length ?? 8)) * 7)));
  const header = (label: string, width: number, key: string) => <Text key={key} role="columnheader" style={{ ...smallStyle(theme), width, fontWeight: "600", paddingRight: 12 }}>{label}</Text>;
  return <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator style={{ flexGrow: 0 }}>
    <View role="table" accessibilityLabel={table.title} style={{ minWidth: "100%" }}>
      <View role="row" style={{ flexDirection: "row", paddingBottom: 8, borderBottomWidth: 1, borderColor: border(theme) }}>
        {header(table.keyLabel, keyWidth, "key")}{table.statusLabel && header(table.statusLabel, 200, "status")}{table.columns.map((label, index) => header(label, widths[index], `column-${index}`))}
      </View>
      {table.rows.map((row, rowIndex) => <View key={`${rowIndex}:${row.key ?? ""}`} role="row" style={{ flexDirection: "row", alignItems: "flex-start", paddingVertical: 8, borderBottomWidth: rowIndex === table.rows.length - 1 ? 0 : 1, borderColor: border(theme) }}>
        <View role="rowheader" style={{ width: keyWidth, paddingRight: 12 }}>{row.key === null ? <Cell value={null} theme={theme} /> : <Text style={{ ...textStyle(theme), fontSize: 13, lineHeight: 19, fontWeight: "600" }}>{row.key}</Text>}</View>
        {table.statusLabel && <View role="cell" style={{ width: 200, paddingRight: 12 }}>{row.status ? <StatusCell status={row.status} theme={theme} /> : <Text style={smallStyle(theme)}>Not attributable</Text>}</View>}
        {row.aligned ? row.cells.map((cell, index) => <View key={index} role="cell" style={{ width: widths[index], paddingRight: 12 }}><Cell value={cell} theme={theme} /></View>)
          : <View role="cell" style={{ width: widths.reduce((total, width) => total + width, 0), paddingRight: 12 }}><Text style={{ ...smallStyle(theme), fontStyle: "italic" }}>Columns could not be aligned for this row; only its key and status are shown.</Text></View>}
      </View>)}
    </View>
  </ScrollView>;
}

function CompactTable({ table, theme }: { table: ValidationTable; theme: BoardTheme }) {
  return <View accessibilityLabel={table.title} style={{ gap: 10 }}>
    {table.rows.map((row, rowIndex) => <View key={`${rowIndex}:${row.key ?? ""}`} style={{ gap: 7, paddingTop: 10, borderTopWidth: rowIndex ? 1 : 0, borderColor: border(theme) }}>
      <Text style={smallStyle(theme)}>{table.keyLabel}</Text>
      {row.key === null ? <Cell value={null} theme={theme} /> : <Text style={{ ...textStyle(theme), fontWeight: "600" }}>{row.key}</Text>}
      {table.statusLabel && (row.status ? <StatusCell status={row.status} theme={theme} /> : <Text style={smallStyle(theme)}>{table.statusLabel}: not attributable</Text>)}
      {row.aligned ? row.cells.map((cell, index) => <View key={index} style={{ gap: 1 }}><Text style={smallStyle(theme)}>{table.columns[index]}</Text><Cell value={cell} theme={theme} /></View>)
        : <Text style={{ ...smallStyle(theme), fontStyle: "italic" }}>Columns could not be aligned for this row; only its key and status are shown.</Text>}
    </View>)}
  </View>;
}

function TableCard({ table, theme, compact }: { table: ValidationTable; theme: BoardTheme; compact: boolean }) {
  return <Card title={table.title} subtitle={tableSubtitle(table)} theme={theme}>
    {table.counts && <StatusCounts counts={table.counts} theme={theme} />}
    {table.conflicts > 0 && <Text role="alert" style={smallStyle(theme, false)}>{table.conflicts} {table.conflicts === 1 ? "row has" : "rows have"} a different status in another table of this document.</Text>}
    {table.hiddenColumns.length > 0 && <Text style={smallStyle(theme)}>Not shown: {table.hiddenColumns.join(", ")} (commands and file locations are withheld).</Text>}
    {table.rows.length ? compact ? <CompactTable table={table} theme={theme} /> : <WideTable table={table} theme={theme} />
      : <Text style={textStyle(theme, true)}>No rows could be shown within the excerpt limit.</Text>}
  </Card>;
}

function ChecklistBlock({ title, checklist, theme }: { title: string; checklist: Checklist; theme: BoardTheme }) {
  const withheld = checklist.total - checklist.done - checklist.open.length;
  return <View style={{ gap: 8 }}>
    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 8 }}>
      <Text style={{ ...textStyle(theme), fontWeight: "600" }}>{title}</Text>
      <Text style={textStyle(theme, true)}>{checklist.total ? `${checklist.done} of ${checklist.total} checked` : "No checklist recorded"}</Text>
    </View>
    {checklist.open.map((item, index) => <View key={index} style={{ flexDirection: "row", alignItems: "flex-start", gap: 9 }}><Text style={textStyle(theme, true)}>○</Text><Text style={{ ...textStyle(theme), flex: 1, minWidth: 0 }}>{item}</Text></View>)}
    {withheld > 0 && <Text style={smallStyle(theme)}>{withheld} open {withheld === 1 ? "item is" : "items are"} withheld by the privacy filter or excerpt limit.</Text>}
    {checklist.note && <Text style={textStyle(theme, true)}>{title === "Sign-off" ? `Approval: ${checklist.note}` : checklist.note}</Text>}
  </View>;
}

function Fact({ label, value, detail, attention, theme }: { label: string; value: string; detail?: string | null; attention?: boolean; theme: BoardTheme }) {
  return <View accessible accessibilityLabel={`${label}: ${value}${detail ? `. ${detail}` : ""}`} style={{ flexGrow: 1, flexBasis: 180, minWidth: 0, padding: 12, gap: 4, borderRadius: 8, borderWidth: 1, borderColor: attention ? theme.colors.statusWarning ?? theme.colors.accent : border(theme), backgroundColor: theme.colors.surface1 ?? theme.colors.surface0 }}>
    <Text style={smallStyle(theme)}>{label}</Text>
    <Text style={{ ...textStyle(theme), fontWeight: "600" }}>{value}</Text>
    {detail && <Text style={smallStyle(theme)}>{detail}</Text>}
  </View>;
}

function PhaseValidation({ phase, theme, compact }: { phase: BoardValidationPhase; theme: BoardTheme; compact: boolean }) {
  if (phase.observation !== "observed") return <Card title={`Phase ${phase.id} · ${phase.title}`} theme={theme}>
    <Text style={textStyle(theme, true)}>{phase.observation === "unavailable" ? "VALIDATION.md could not be read safely for this phase." : "No VALIDATION.md observed for this phase."}</Text>
  </Card>;
  const audit = latestAudit(phase.audits);
  const verification = phase.tables.filter((table) => table.role === "verification");
  const others = phase.tables.filter((table) => table.role !== "verification");
  return <View style={{ gap: 16 }}>
    <View style={{ gap: 5 }}>
      <Text role="heading" style={{ ...textStyle(theme), fontSize: 19, lineHeight: 25, fontWeight: "600" }}>Phase {phase.id} · {phase.title}</Text>
      <Text style={smallStyle(theme)}>VALIDATION.md observed{phase.createdAt ? ` · Created ${phase.createdAt}` : ""}{phase.updatedAt ? ` · Last updated ${phase.updatedAt}` : ""}</Text>
      <Text style={smallStyle(theme)}>Statuses are recorded in the document; they are not a live test run.</Text>
      {JSON.stringify(phase).includes("[omitted]") && <Text style={smallStyle(theme)}>Commands, file locations and host-like text are shown as [omitted].</Text>}
      {phase.excerptsLimited && <Text role="alert" style={smallStyle(theme)}>Some validation text could not be safely extracted or was shortened.</Text>}
    </View>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
      <Fact label="Recorded status" value={phase.recordedStatus ?? "Not recorded"} detail={phase.otherStatuses.map((item) => `${item.label}: ${item.value}`).join(" · ") || null} theme={theme} />
      <Fact label="Nyquist compliant" value={yesNo(phase.nyquistCompliant)} attention={phase.nyquistCompliant === false} theme={theme} />
      <Fact label="Wave 0 complete" value={yesNo(phase.wave0Complete)} attention={phase.wave0Complete === false} theme={theme} />
      <Fact label="Latest audit" value={audit ? auditMetrics(audit) : "None recorded"} detail={audit ? audit.title : null} attention={!!audit?.escalated} theme={theme} />
    </View>
    {verification.length ? verification.map((table, index) => <TableCard key={`verification-${index}`} table={table} theme={theme} compact={compact} />)
      : <Card title="Verification table" theme={theme}><Text style={textStyle(theme, true)}>No verification table with a status column was recorded.</Text></Card>}
    {others.map((table, index) => <TableCard key={`other-${index}`} table={table} theme={theme} compact={compact} />)}
    <Card title="Open items" theme={theme}>
      {phase.wave0 ? <ChecklistBlock title="Wave 0" checklist={phase.wave0} theme={theme} /> : <Text style={textStyle(theme, true)}>No Wave 0 section recorded.</Text>}
      <View style={{ height: 1, backgroundColor: border(theme) }} />
      {phase.signOff ? <ChecklistBlock title="Sign-off" checklist={phase.signOff} theme={theme} /> : <Text style={textStyle(theme, true)}>No sign-off section recorded.</Text>}
      {phase.manualNote && <><View style={{ height: 1, backgroundColor: border(theme) }} /><View style={{ gap: 6 }}><Text style={{ ...textStyle(theme), fontWeight: "600" }}>Manual-only verifications</Text><Text style={textStyle(theme, true)}>{phase.manualNote}</Text></View></>}
    </Card>
    <View style={{ flexDirection: compact ? "column" : "row", alignItems: "flex-start", gap: 16 }}>
      <View style={{ flex: 1, minWidth: 0, alignSelf: "stretch" }}>
        <Card title="Test infrastructure" theme={theme}>
          {phase.infrastructure.length ? phase.infrastructure.map((field, index) => <View key={index} style={{ gap: 1 }}>
            <Text style={smallStyle(theme)}>{field.label}</Text>
            <Text style={textStyle(theme, !field.value)}>{field.value ?? (field.withheld === "command" ? "Recorded; not shown (command or file location)." : "Recorded; withheld by the privacy filter.")}</Text>
          </View>) : <Text style={textStyle(theme, true)}>No test infrastructure table recorded.</Text>}
        </Card>
      </View>
      <View style={{ flex: 1, minWidth: 0, alignSelf: "stretch", gap: 16 }}>
        <Card title="Audits" subtitle={phase.auditCount ? `${phase.auditCount} audit ${phase.auditCount === 1 ? "section" : "sections"} recorded` : undefined} theme={theme}>
          {phase.audits.length ? [...phase.audits].reverse().map((item, index) => <View key={index} style={{ gap: 1 }}>
            <Text style={{ ...textStyle(theme), fontWeight: item === audit ? "600" : "400" }}>{item.title}{item === audit ? " · latest" : ""}</Text>
            <Text style={smallStyle(theme)}>{auditMetrics(item)}</Text>
          </View>) : <Text style={textStyle(theme, true)}>No validation audit recorded.</Text>}
        </Card>
        {phase.sections.length > 0 && <Card title="Document sections" theme={theme}>
          <Text style={textStyle(theme, true)}>{phase.sections.join(" · ")}</Text>
        </Card>}
      </View>
    </View>
  </View>;
}

export function ValidationView({ state, onRefresh, theme, compact = false }: { state: BoardViewState; onRefresh(): void; theme: BoardTheme; compact?: boolean }) {
  const [selection, setSelection] = useState<{ workspaceId: string; phaseId: string } | null>(null);
  const validation = state.snapshot?.overview?.validation;
  const defaultId = validation?.phases.find((phase) => phase.current)?.id ?? validation?.phases[0]?.id;
  const selectedId = selection?.workspaceId === state.workspaceId && validation?.phases.some((phase) => phase.id === selection.phaseId) ? selection.phaseId : defaultId;
  const selected = validation?.phases.find((phase) => phase.id === selectedId);
  return <ScrollView style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ padding: compact ? 16 : 24, paddingBottom: 32, gap: 18 }} nestedScrollEnabled>
    <View style={{ flexDirection: compact ? "column" : "row", justifyContent: "space-between", alignItems: compact ? "stretch" : "center", gap: 14 }}>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}><Text role="heading" style={{ ...textStyle(theme), fontSize: 24, lineHeight: 30, fontWeight: "600" }}>Validation</Text><Text style={textStyle(theme, true)}>Current-milestone validation strategy and recorded verification status.</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel={state.busy ? "Refreshing validation" : "Refresh validation"} accessibilityState={{ disabled: state.busy, busy: state.busy }} disabled={state.busy} onPress={onRefresh} style={{ minHeight: 44, alignSelf: compact ? "flex-start" : "auto", justifyContent: "center", paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, borderColor: border(theme), backgroundColor: theme.colors.surface1 ?? theme.colors.surface0 }}><Text style={textStyle(theme)}>{state.busy ? "Refreshing…" : "Refresh"}</Text></Pressable>
    </View>
    {state.busy && !state.snapshot ? <Text accessibilityLiveRegion="polite" style={textStyle(theme, true)}>Loading validation…</Text> : <>
      {state.error && <Text role="alert" style={textStyle(theme)}>Could not refresh validation. {state.snapshot ? "The last snapshot is still displayed." : "Try refreshing again."}</Text>}
      {(state.snapshot?.freshness === "stale" || state.snapshot?.freshness === "refresh-failed") && <Text style={textStyle(theme, true)}>Planning files may have changed. Refresh to update validation.</Text>}
      {state.refreshAnnouncement && <Text accessibilityLiveRegion="polite" style={textStyle(theme, true)}>{state.refreshAnnouncement}</Text>}
      {validation?.availability === "available" ? <>
        {validation.limited && <Text role="alert" style={smallStyle(theme)}>Some validation evidence or safe excerpts may be incomplete.</Text>}
        {validation.phases.length > 0 ? <>
          <View accessibilityLabel="Validation phases" style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {validation.phases.map((phase) => {
              const summary = phaseSummary(phase);
              const selected = phase.id === selectedId;
              return <Pressable key={phase.id} accessibilityRole="button" accessibilityLabel={`Phase ${phase.id}${phase.current ? ", current" : ""}: ${summary.text}`} accessibilityState={{ selected }} {...(Platform.OS === "web" ? { "aria-pressed": selected } : {})} onPress={() => setSelection({ workspaceId: state.workspaceId, phaseId: phase.id })} style={{ minHeight: 44, justifyContent: "center", gap: 1, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 7, borderWidth: 1, borderColor: selected ? theme.colors.accent : border(theme), backgroundColor: selected ? theme.colors.surface2 ?? theme.colors.surface0 : theme.colors.surface1 ?? theme.colors.surface0 }}>
                <Text style={{ ...textStyle(theme), fontWeight: selected ? "600" : "400" }}>Phase {phase.id}{phase.current ? " · Current" : ""}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  {summary.attention && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: theme.colors.statusWarning ?? theme.colors.accent }} />}
                  <Text style={smallStyle(theme)}>{summary.text}</Text>
                </View>
              </Pressable>;
            })}
          </View>
          {selected && <PhaseValidation phase={selected} theme={theme} compact={compact} />}
        </> : <Text style={textStyle(theme, true)}>No current-milestone phases declared in the roadmap.</Text>}
      </> : <Card title="Validation unavailable" theme={theme}><Text style={textStyle(theme, true)}>No readable current-milestone roadmap was found.</Text></Card>}
    </>}
  </ScrollView>;
}
