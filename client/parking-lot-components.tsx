import { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import type { BoardParkingLot, ParkingLotItem } from "../shared/parking-lot.js";
import type { BoardTheme, BoardViewState } from "./board-components.js";

type Disposition = ParkingLotItem["disposition"];
type Filter = Disposition | "all";
const filters: readonly Filter[] = ["all", "parked", "reconciliation", "absorbed", "promoted", "other"];
const labels: Record<Filter, string> = { all: "All", parked: "Parked", reconciliation: "Needs reconciliation", absorbed: "Absorbed", promoted: "Promoted", other: "Unclassified" };
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const textStyle = (theme: BoardTheme, muted = false) => ({ color: muted ? theme.colors.foregroundMuted : theme.colors.foreground, fontSize: 14, lineHeight: 21, flexShrink: 1 });
const smallStyle = (theme: BoardTheme, muted = true) => ({ ...textStyle(theme, muted), fontSize: 12, lineHeight: 18 });
const border = (theme: BoardTheme) => theme.colors.border ?? theme.colors.foregroundMuted;
const surface = (theme: BoardTheme) => theme.colors.surface1 ?? theme.colors.surface0;

export const matchingParkingEntries = (data: BoardParkingLot, filter: Filter) => data.items.filter((item) => filter === "all" || item.disposition === filter);

function Card({ title, subtitle, children, theme }: { title: string; subtitle?: string; children: React.ReactNode; theme: BoardTheme }) {
  return <View style={{ minWidth: 0, padding: 16, gap: 10, borderRadius: 10, borderWidth: 1, borderColor: border(theme), backgroundColor: surface(theme) }}>
    <View style={{ gap: 2 }}><Text role="heading" style={{ ...textStyle(theme), fontSize: 16, fontWeight: "600" }}>{title}</Text>{subtitle && <Text style={smallStyle(theme)}>{subtitle}</Text>}</View>
    {children}
  </View>;
}

function Fact({ label, value, attention, theme }: { label: string; value: number; attention?: boolean; theme: BoardTheme }) {
  return <View accessible accessibilityLabel={`${label}: ${value}`} style={{ flexBasis: 150, flexGrow: 1, padding: 12, gap: 4, borderRadius: 8, borderWidth: 1, borderColor: attention ? theme.colors.statusWarning ?? theme.colors.accent : border(theme), backgroundColor: surface(theme) }}>
    <Text style={smallStyle(theme)}>{label}</Text><Text style={{ ...textStyle(theme), fontSize: 18, fontWeight: "600" }}>{value}</Text>
  </View>;
}

function FilterButton({ label, selected, onPress, theme }: { label: string; selected: boolean; onPress(): void; theme: BoardTheme }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`Filter: ${label}`} accessibilityState={{ selected }} {...(Platform.OS === "web" ? { "aria-pressed": selected } : {})} onPress={onPress}
    style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 12, borderRadius: 7, borderWidth: 1, borderColor: selected ? theme.colors.accent : border(theme), backgroundColor: selected ? theme.colors.surface2 ?? theme.colors.surface0 : surface(theme) }}>
    <Text style={{ ...textStyle(theme), fontWeight: selected ? "600" : "400" }}>{label}</Text>
  </Pressable>;
}

function Detail({ label, value, theme }: { label: string; value: string | null; theme: BoardTheme }) {
  if (!value) return null;
  return <Text style={textStyle(theme, true)}><Text style={{ ...textStyle(theme), fontWeight: "600" }}>{label}: </Text>{value}</Text>;
}

function Entry({ item, theme, compact }: { item: ParkingLotItem; theme: BoardTheme; compact: boolean }) {
  const caution = item.disposition === "reconciliation" || item.disposition === "other";
  return <View style={{ minWidth: 0, padding: 16, gap: 9, borderRadius: 10, borderWidth: 1, borderColor: caution ? theme.colors.statusWarning ?? theme.colors.accent : border(theme), backgroundColor: surface(theme) }}>
    <View style={{ flexDirection: compact ? "column" : "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
      <Text role="heading" style={{ ...textStyle(theme), fontSize: 16, fontWeight: "600", flex: compact ? undefined : 1, minWidth: 0 }}>Phase {item.id} · {item.title ?? "Title withheld"}</Text>
      <Text style={{ ...smallStyle(theme, !caution), fontWeight: "600" }}>{labels[item.disposition]}</Text>
    </View>
    {item.recordedLabel && <Detail label="As recorded" value={item.recordedLabel} theme={theme} />}
    <Detail label="Goal" value={item.goal} theme={theme} />
    <Detail label="Requirements" value={item.requirements} theme={theme} />
    <Detail label="Plans, as written" value={item.plans} theme={theme} />
    {item.checklist && <Text style={smallStyle(theme)}>{item.checklist.checked} of {item.checklist.total} visible top-level checklist markers checked. Nested or indented markers are not counted; these are not proof of completion.</Text>}
    {item.laterNote && <Text role="alert" style={textStyle(theme)}>{item.laterNote}</Text>}
    {item.disposition === "absorbed" || item.disposition === "promoted" ? <Text style={smallStyle(theme)}>This entry records a transfer; it is not counted as parked work.</Text> : null}
    {item.excerptsLimited && <Text style={smallStyle(theme)}>Some wording was withheld or shortened for safe display.</Text>}
  </View>;
}

export function ParkingLotView({ state, onRefresh, theme, compact = false }: { state: BoardViewState; onRefresh(): void; theme: BoardTheme; compact?: boolean }) {
  const [selection, setSelection] = useState<{ workspaceId: string; filter: Filter }>({ workspaceId: state.workspaceId, filter: "all" });
  const data = state.snapshot?.overview?.parkingLot;
  const selected = selection.workspaceId === state.workspaceId ? selection.filter : "all";
  const listed = data ? matchingParkingEntries(data, selected) : [];
  return <ScrollView style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ padding: compact ? 16 : 24, paddingBottom: 32, gap: 16 }} nestedScrollEnabled>
    <View style={{ flexDirection: compact ? "column" : "row", justifyContent: "space-between", alignItems: compact ? "stretch" : "center", gap: 14 }}>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}><Text role="heading" style={{ ...textStyle(theme), fontSize: 24, lineHeight: 30, fontWeight: "600" }}>Parking Lot</Text>
        <Text style={textStyle(theme, true)}>Unsequenced 999.x entries recorded in the current ROADMAP.md Backlog section. These are not executable phases or standalone TODO files.</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel={state.busy ? "Refreshing parking lot" : "Refresh parking lot"} accessibilityState={{ disabled: state.busy, busy: state.busy }} disabled={state.busy} onPress={onRefresh}
        style={{ minHeight: 44, alignSelf: compact ? "flex-start" : "auto", justifyContent: "center", paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, borderColor: border(theme), backgroundColor: surface(theme) }}><Text style={textStyle(theme)}>{state.busy ? "Refreshing…" : "Refresh"}</Text></Pressable>
    </View>
    {state.busy && !state.snapshot ? <Text accessibilityLiveRegion="polite" style={textStyle(theme, true)}>Loading parking lot…</Text> : <>
      {state.error && <Text role="alert" style={textStyle(theme)}>Could not refresh the parking lot. {state.snapshot ? "The last snapshot is still displayed." : "Try refreshing again."}</Text>}
      {(state.snapshot?.freshness === "stale" || state.snapshot?.freshness === "refresh-failed") && <Text style={textStyle(theme, true)}>Planning files may have changed. Refresh to update the parking lot.</Text>}
      {state.refreshAnnouncement && <Text accessibilityLiveRegion="polite" style={textStyle(theme, true)}>{state.refreshAnnouncement}</Text>}
      {data?.availability === "available" ? <>
        {data.limited && <Text role="alert" style={smallStyle(theme)}>Some parking-lot entries or safe excerpts may be incomplete; counts cover only observed headings.</Text>}
        {data.section === "observed" ? <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            <Fact label="Recorded entries" value={data.counts.recorded} theme={theme} />
            <Fact label="Parked" value={data.counts.parked} theme={theme} />
            <Fact label="Needs reconciliation" value={data.counts.reconciliation} attention={data.counts.reconciliation > 0} theme={theme} />
            <Fact label="Absorbed / promoted" value={data.counts.absorbed + data.counts.promoted} theme={theme} />
          </View>
          <Text style={smallStyle(theme)}>{plural(data.counts.displayed, "safe card")} shown from {plural(data.counts.recorded, "recorded heading")}. Recorded dispositions, not live verification results.</Text>
          {data.counts.recorded > 0 ? <>
            <View style={{ gap: 7 }}><Text role="heading" style={{ ...textStyle(theme), fontWeight: "600" }}>Disposition</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{filters.map((value) => <FilterButton key={value} label={labels[value]} selected={selected === value} onPress={() => setSelection({ workspaceId: state.workspaceId, filter: value })} theme={theme} />)}</View>
            </View>
            <View style={{ gap: 10 }}>
              <Text style={smallStyle(theme)}>{plural(listed.length, "entry", "entries")} {listed.length === 1 ? "matches" : "match"} this filter{data.counts.displayed < data.counts.recorded ? "; additional headings may lack safe cards" : ""}.</Text>
              {listed.length ? listed.map((item, index) => <Entry key={`${item.id}:${index}`} item={item} theme={theme} compact={compact} />)
                : <Card title="No matching entries" theme={theme}><Text style={textStyle(theme, true)}>No displayed parking-lot entries match this disposition.</Text></Card>}
            </View>
          </> : <Card title="No parked entries" theme={theme}><Text style={textStyle(theme, true)}>The Backlog section is present, but contains no recorded 999.x entries.</Text></Card>}
        </> : <Card title="No parking-lot section" theme={theme}><Text style={textStyle(theme, true)}>The readable current ROADMAP.md has no Backlog section.</Text></Card>}
      </> : <Card title="Parking lot unavailable" theme={theme}><Text style={textStyle(theme, true)}>The current ROADMAP.md could not be read safely.</Text></Card>}
    </>}
  </ScrollView>;
}
