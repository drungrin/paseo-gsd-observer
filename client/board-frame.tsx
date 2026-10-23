import { useEffect, useState, type ReactNode } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import type { BoardTheme, BoardViewState } from "./board-components.js";
import type { BoardTab } from "./board-tabs.js";
import { dateLabel, Disclosure, FadeIn, figures, kicker, Pulse, RelativeTime, Section, surface, text, tint, toneColor, type Tone } from "./ui-kit.js";

/** The frame, live status, cards and tables every board tab shares, GSD Core and GSD Path alike. */

export type ThemeProps = { theme: BoardTheme };
export const textStyle = (theme: BoardTheme, muted = false) => ({ color: muted ? theme.colors.foregroundMuted : theme.colors.foreground, fontSize: 14, lineHeight: 21, flexShrink: 1 });
export const smallStyle = (theme: BoardTheme, muted = true) => ({ ...textStyle(theme, muted), fontSize: 12, lineHeight: 18 });
export const borderColor = (theme: BoardTheme) => theme.colors.border ?? theme.colors.foregroundMuted;
export const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** A recorded token as words: "in-progress" reads "In progress", "pull-request" reads "Pull request". */
export const tokenLabel = (value: string | null, missing = "Not recorded") => value ? `${value[0].toUpperCase()}${value.slice(1).replace(/-/g, " ")}` : missing;

/** A raised card: an optional source above the title, an optional subtitle below it; `attention` washes it in the warning color. */
export function Card({ title, source, subtitle, children, theme, attention = false }: ThemeProps & { title: string; source?: string; subtitle?: string | null; children: ReactNode; attention?: boolean }) {
  const warning = toneColor(theme, "warning");
  return <View style={{ minWidth: 0, padding: 20, gap: 14, borderRadius: 16, overflow: "hidden", backgroundColor: attention ? tint(theme, warning, 0.09) : surface(theme) }}>
    {attention && <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, backgroundColor: warning }} />}
    <View style={{ gap: 2 }}>
      {source && <Text style={{ ...kicker(theme), textTransform: "none", letterSpacing: 0.2 }}>{source}</Text>}
      <Text role="heading" style={{ ...textStyle(theme), fontSize: 16, fontWeight: "600" }}>{title}</Text>
      {subtitle && <Text style={smallStyle(theme)}>{subtitle}</Text>}
    </View>
    {children}
  </View>;
}

export function Badge({ label, theme, attention = false }: ThemeProps & { label: string; attention?: boolean }) {
  const color = attention ? toneColor(theme, "warning") : theme.colors.foregroundMuted;
  return <Text style={{ color, fontSize: 12, fontWeight: "500", paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, overflow: "hidden", backgroundColor: attention ? tint(theme, color, 0.13) : surface(theme, 2) }}>{label}</Text>;
}

export function Count({ label, value, theme, attention = false }: ThemeProps & { label: string; value: number; attention?: boolean }) {
  const warn = attention && value > 0;
  return <View accessible accessibilityLabel={`${label}: ${value}`} style={{ flexBasis: 120, flexGrow: 1, paddingVertical: 12, paddingHorizontal: 14, gap: 2, borderRadius: 12, backgroundColor: warn ? tint(theme, toneColor(theme, "warning"), 0.12) : surface(theme, 2) }}>
    <Text style={kicker(theme)}>{label}</Text>
    <Text style={{ ...textStyle(theme), ...figures, fontWeight: "700", fontSize: 22, lineHeight: 28, color: warn ? toneColor(theme, "warning") : theme.colors.foreground }}>{value}</Text>
  </View>;
}

/** Whether the panel is following the files: live, catching up with a change, not watching, or out of date. */
export function liveStatus(state: BoardViewState): { tone: Tone; label: string; live: boolean } {
  const snapshot = state.snapshot;
  if (state.statusFailed) return { tone: "warning", label: "Cannot reach the plugin · retrying", live: false };
  if (state.error || snapshot?.freshness === "refresh-failed") return { tone: "danger", label: "Out of date", live: false };
  if (snapshot?.freshness === "stale" || state.busy) return { tone: "warning", label: "Files changed · updating", live: true };
  if (snapshot?.warnings.includes("observation-limited")) return { tone: "warning", label: "Not following changes · refresh to update", live: false };
  return { tone: "success", label: "Live · last read ", live: true };
}

function LiveChip({ state, theme }: ThemeProps & { state: BoardViewState }) {
  const status = liveStatus(state);
  const color = toneColor(theme, status.tone);
  const style = { ...textStyle(theme), fontSize: 12, lineHeight: 16, fontWeight: "500" as const, color };
  // Not a live region: the relative time changes every minute. The change banner is what gets announced.
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 2, minHeight: 28, paddingLeft: status.live ? 0 : 10, paddingRight: 12, borderRadius: 999, backgroundColor: tint(theme, color, 0.12) }}>
    {status.live ? <Pulse color={color} size={7} /> : <View style={{ width: 8, height: 8, marginRight: 6, borderRadius: 4, backgroundColor: color }} />}
    {status.tone === "success" ? <RelativeTime theme={theme} value={state.snapshot?.observedAt} prefix={status.label} style={style} /> : <Text style={style}>{status.label}</Text>}
  </View>;
}

/** How long "Just changed" stays up after an automatic refresh. */
const CHANGE_BANNER_MS = 8_000;

function ChangeBanner({ state, theme }: ThemeProps & { state: BoardViewState }) {
  const changes = state.changes;
  const [hiddenAt, setHiddenAt] = useState<number | null>(null);
  useEffect(() => {
    if (!changes) return;
    const timer = setTimeout(() => setHiddenAt(changes.at), Math.max(0, changes.at + CHANGE_BANNER_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [changes]);
  if (!changes || hiddenAt === changes.at || Date.now() - changes.at > CHANGE_BANNER_MS) return null;
  const accent = toneColor(theme, "accent");
  return <FadeIn><View accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, backgroundColor: tint(theme, accent, 0.14) }}>
    <Pulse color={accent} size={6} />
    <Text style={{ ...textStyle(theme), fontSize: 13, fontWeight: "500" }}>Just changed: {changes.summary.slice(0, 4).join(" · ")}{changes.summary.length > 4 ? ` · ${changes.summary.length - 4} more` : ""}</Text>
  </View></FadeIn>;
}

/**
 * Header, live status, refresh control and the notes around one board tab. `alerts` qualify what the tab shows (partial reads,
 * evidence left out) and stay visible; `notes` explain how to read it and are folded under "About these figures".
 */
export function BoardFrame({ title, description, subject, state, onRefresh, theme, compact, alerts = [], notes = [], children }: ThemeProps & { title: string; description: string; subject: string; state: BoardViewState; onRefresh(): void; compact: boolean; alerts?: readonly string[]; notes?: readonly string[]; children: ReactNode }) {
  return <ScrollView style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ padding: compact ? 16 : 28, gap: 18, paddingBottom: 40 }} nestedScrollEnabled>
    <View style={{ flexDirection: compact ? "column" : "row", justifyContent: "space-between", alignItems: compact ? "flex-start" : "center", gap: 12 }}>
      <View style={{ gap: 2, flex: 1, minWidth: 0 }}><Text role="heading" style={{ ...textStyle(theme), fontSize: 22, lineHeight: 28, fontWeight: "700" }}>{title}</Text><Text style={{ ...textStyle(theme, true), fontSize: 13 }}>{description}</Text></View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <LiveChip state={state} theme={theme} />
        <Pressable accessibilityRole="button" accessibilityLabel={state.busy ? `Refreshing ${subject}` : `Refresh ${subject}`} accessibilityState={{ disabled: state.busy, busy: state.busy }} disabled={state.busy} onPress={onRefresh} style={{ minHeight: 36, justifyContent: "center", paddingHorizontal: 14, borderRadius: 999, backgroundColor: surface(theme, 2) }}><Text style={{ ...textStyle(theme), fontSize: 13, fontWeight: "500" }}>{state.busy ? "Refreshing…" : "Refresh"}</Text></Pressable>
      </View>
    </View>
    <ChangeBanner state={state} theme={theme} />
    {state.busy && !state.snapshot ? <Text accessibilityLiveRegion="polite" style={textStyle(theme, true)}>Loading {subject}…</Text> : <>
      {state.error && <Text role="alert" style={{ ...textStyle(theme), color: toneColor(theme, "danger") }}>Could not refresh {subject}. {state.snapshot ? "The last snapshot is still displayed." : "Try refreshing again."}</Text>}
      {state.refreshAnnouncement && <Text accessibilityLiveRegion="polite" style={smallStyle(theme)}>{state.refreshAnnouncement}</Text>}
      {alerts.length > 0 && <View style={{ gap: 4 }}>{alerts.map((alert) => <View key={alert} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
        <View style={{ width: 6, height: 6, marginTop: 7, borderRadius: 3, backgroundColor: toneColor(theme, "warning") }} />
        <Text role="alert" style={{ ...smallStyle(theme, false), fontSize: 13, lineHeight: 20, flex: 1 }}>{alert}</Text>
      </View>)}</View>}
      {children}
      <Disclosure title="About these figures" notes={[...notes, `Last read ${dateLabel(state.snapshot?.observedAt ?? null)}. The panel reads the project files again when they change.`]} theme={theme} />
    </>}
  </ScrollView>;
}

export type TableColumn = { label: string; width: number; numeric?: boolean };

/** A scrollable data table: one row header, then cells; numeric columns align right in tabular figures. */
export function DataTable({ label, columns, rows, theme }: ThemeProps & { label: string; columns: readonly TableColumn[]; rows: readonly (readonly string[])[] }) {
  const cell = (column: TableColumn, header = false) => ({ ...smallStyle(theme, header), fontSize: header ? 12 : 13, fontWeight: header ? "600" as const : "400" as const, width: column.width, paddingHorizontal: 6, textAlign: column.numeric ? "right" as const : "left" as const, fontVariant: column.numeric ? ["tabular-nums" as const] : undefined });
  return <ScrollView horizontal nestedScrollEnabled style={{ flexGrow: 0 }}>
    <View role="table" accessibilityLabel={label} style={{ minWidth: columns.reduce((total, column) => total + column.width, 0) }}>
      <View role="row" style={{ flexDirection: "row", paddingVertical: 8, borderBottomWidth: 1, borderColor: borderColor(theme) }}>
        {columns.map((column) => <Text key={column.label} role="columnheader" style={cell(column, true)}>{column.label}</Text>)}
      </View>
      {rows.map((row, index) => <View key={index} role="row" style={{ flexDirection: "row", paddingVertical: 8, borderBottomWidth: 1, borderColor: borderColor(theme) }}>
        {row.map((value, column) => <Text key={column} role={column === 0 ? "rowheader" : "cell"} style={{ ...cell(columns[column]), color: theme.colors.foreground }}>{value}</Text>)}
      </View>)}
    </View>
  </ScrollView>;
}

/** A filter choice that stays pressed while selected. */
export function FilterChip({ label, selected, onPress, theme }: ThemeProps & { label: string; selected: boolean; onPress(): void }) {
  const accent = toneColor(theme, "accent");
  return <Pressable accessibilityRole="button" accessibilityLabel={`Filter: ${label}`} accessibilityState={{ selected }} {...(Platform.OS === "web" ? { "aria-pressed": selected } : {})} onPress={onPress}
    style={{ minHeight: 36, justifyContent: "center", paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: selected ? accent : "transparent", backgroundColor: selected ? tint(theme, accent, 0.16) : surface(theme, 2) }}>
    <Text style={{ ...textStyle(theme, !selected), fontSize: 13, fontWeight: selected ? "600" : "400" }}>{label}</Text>
  </Pressable>;
}

/** Paseo's live state for the workspace's agents, which the files cannot tell. */
export type WorkspaceAgent = { status: "needs_input" | "failed" | "running" | "attention" | "done"; since: string | null } | null;

/** One thing waiting on a person; `tab` is where it can be seen in full. */
export type Need = { tone: Tone; title: string; detail: string | null; tab: BoardTab | null };

const AGENT_VIEW = {
  running: { tone: "accent", label: "Agent running" },
  needs_input: { tone: "warning", label: "Agent waiting for you" },
  attention: { tone: "warning", label: "Agent finished · needs a look" },
  failed: { tone: "danger", label: "Agent failed" },
  done: { tone: "neutral", label: "Agents idle" },
} as const;

/** Paseo's live status for the workspace's agents. */
export function AgentChip({ agent, theme }: ThemeProps & { agent: WorkspaceAgent }) {
  if (!agent) return null;
  const view = AGENT_VIEW[agent.status];
  const color = toneColor(theme, view.tone);
  const moving = agent.status === "running" || agent.status === "needs_input";
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 2, minHeight: 28, paddingLeft: moving ? 0 : 10, paddingRight: 12, borderRadius: 999, backgroundColor: tint(theme, color, 0.14) }}>
    {moving ? <Pulse color={color} size={7} /> : <View style={{ width: 8, height: 8, marginRight: 6, borderRadius: 4, backgroundColor: color }} />}
    <Text style={{ ...text(theme, 12, "600"), color }}>{view.label}</Text>
    {agent.since && <RelativeTime theme={theme} value={agent.since} prefix=" · since " style={text(theme, 12, "400", true)} />}
  </View>;
}

/** What waits on a person, each item opening the tab it is in; a calm line when nothing does. */
export function Needs({ needs, calm, theme, onNavigate }: ThemeProps & { needs: readonly Need[]; calm: string; onNavigate(tab: BoardTab): void }) {
  const success = toneColor(theme, "success");
  if (!needs.length) return <View accessible style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 14, backgroundColor: tint(theme, success, 0.1) }}>
    <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: tint(theme, success, 0.25) }}><Text style={{ ...text(theme, 15, "700"), color: success }}>✓</Text></View>
    <View style={{ flex: 1, gap: 1 }}>
      <Text style={text(theme, 15, "600")}>Nothing needs you right now</Text>
      <Text style={text(theme, 13, "400", true)}>{calm}</Text>
    </View>
  </View>;
  return <Section theme={theme} tone={needs.some((need) => need.tone === "danger") ? "danger" : "warning"} overline={`Needs you · ${needs.length}`} gap={4} padding={16}>
    <View role="list" accessibilityLabel="What needs you">
      {needs.map((need, index) => {
        const body = <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start", paddingVertical: 8 }}>
          <View style={{ width: 8, height: 8, marginTop: 7, borderRadius: 4, backgroundColor: toneColor(theme, need.tone) }} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={text(theme, 14, "600")}>{need.title}</Text>
            {need.detail && <Text numberOfLines={2} style={text(theme, 13, "400", true)}>{need.detail}</Text>}
          </View>
          {need.tab && <Text style={{ ...text(theme, 12, "600"), color: toneColor(theme, need.tone) }}>Open →</Text>}
        </View>;
        const tab = need.tab;
        return <View key={index} role="listitem">{tab ? <Pressable role="button" accessibilityLabel={`${need.title}. Open ${tab}.`} onPress={() => onNavigate(tab)}>{body}</Pressable> : body}</View>;
      })}
    </View>
  </Section>;
}

