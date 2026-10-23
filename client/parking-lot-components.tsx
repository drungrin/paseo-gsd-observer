import { useState } from "react";
import { Text, View } from "react-native";
import type { BoardParkingLot, ParkingLotItem } from "../shared/parking-lot.js";
import type { BoardTheme, BoardViewState } from "./board-components.js";
import { BoardFrame, Card, Count, FilterChip, plural, smallStyle, textStyle, type ThemeProps } from "./board-frame.js";
import { Legend, Pill, SegmentBar, surface, tint, toneColor } from "./ui-kit.js";

type Disposition = ParkingLotItem["disposition"];
type Filter = Disposition | "all";
const filters: readonly Filter[] = ["all", "parked", "reconciliation", "absorbed", "promoted", "other"];
const labels: Record<Filter, string> = { all: "All", parked: "Parked", reconciliation: "Needs reconciliation", absorbed: "Absorbed", promoted: "Promoted", other: "Unclassified" };

export const matchingParkingEntries = (data: BoardParkingLot, filter: Filter) => data.items.filter((item) => filter === "all" || item.disposition === filter);

function Detail({ label, value, theme }: { label: string; value: string | null; theme: BoardTheme }) {
  if (!value) return null;
  return <Text style={textStyle(theme, true)}><Text style={{ ...textStyle(theme), fontWeight: "600" }}>{label}: </Text>{value}</Text>;
}

const dispositionColor = (theme: BoardTheme, disposition: Disposition) => disposition === "parked" ? theme.colors.foreground : disposition === "reconciliation" ? toneColor(theme, "warning")
  : disposition === "other" ? tint(theme, toneColor(theme, "warning"), 0.5) : disposition === "promoted" ? toneColor(theme, "success") : tint(theme, theme.colors.foregroundMuted, 0.4);

function Entry({ item, theme, compact }: { item: ParkingLotItem; theme: BoardTheme; compact: boolean }) {
  const caution = item.disposition === "reconciliation" || item.disposition === "other";
  const warning = toneColor(theme, "warning");
  return <View style={{ minWidth: 0, padding: 18, gap: 9, borderRadius: 16, overflow: "hidden", backgroundColor: caution ? tint(theme, warning, 0.09) : surface(theme) }}>
    {caution && <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, backgroundColor: warning }} />}
    <View style={{ flexDirection: compact ? "column" : "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
      <Text role="heading" style={{ ...textStyle(theme), fontSize: 16, fontWeight: "600", flex: compact ? undefined : 1, minWidth: 0 }}>Phase {item.id} · {item.title ?? "Title withheld"}</Text>
      <Pill theme={theme} tone={caution ? "warning" : item.disposition === "promoted" ? "success" : "neutral"} label={labels[item.disposition]} />
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

/** The recorded entries by disposition; when the roadmap was read only in part each figure is a lower bound. */
function DispositionBar({ counts, lowerBound, theme }: ThemeProps & { counts: BoardParkingLot["counts"]; lowerBound: boolean }) {
  const least = lowerBound ? "at least " : "";
  const kinds: Disposition[] = ["parked", "reconciliation", "other", "absorbed", "promoted"];
  return <View style={{ gap: 8 }}>
    <SegmentBar theme={theme} height={12} label={kinds.map((kind) => `${least}${counts[kind]} ${labels[kind].toLowerCase()}`).join(", ")} segments={kinds.map((kind) => ({ label: kind, value: counts[kind], color: dispositionColor(theme, kind) }))} />
    <Legend theme={theme} items={kinds.filter((kind) => counts[kind] > 0).map((kind) => ({ color: dispositionColor(theme, kind), label: `${least}${counts[kind]} ${labels[kind].toLowerCase()}` }))} />
  </View>;
}

/** The caveats behind the parking lot tab. */
export const parkingLotNotes = () => [
  "Unsequenced 999.x entries recorded in the current ROADMAP.md Backlog section. These are not executable phases or standalone TODO files.",
  "Recorded dispositions, not live verification results. Checklist markers count visible top-level markers only and are not proof of completion.",
];

export function ParkingLotView({ state, onRefresh, theme, compact = false }: ThemeProps & { state: BoardViewState; onRefresh(): void; compact?: boolean }) {
  const [selection, setSelection] = useState<{ workspaceId: string; filter: Filter }>({ workspaceId: state.workspaceId, filter: "all" });
  const data = state.snapshot?.overview?.parkingLot;
  const selected = selection.workspaceId === state.workspaceId ? selection.filter : "all";
  const listed = data ? matchingParkingEntries(data, selected) : [];
  return <BoardFrame title="Parking Lot" description="Ideas parked in the roadmap's Backlog section, and what became of them." subject="parking lot" state={state} onRefresh={onRefresh} theme={theme} compact={compact}
    alerts={data?.limited ? ["Some parking-lot entries or safe excerpts may be incomplete; counts cover only observed headings."] : []} notes={parkingLotNotes()}>
    {data?.availability === "available" ? <>
      {data.section === "observed" ? <>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          <Count label="Recorded entries" value={data.counts.recorded} theme={theme} />
          <Count label="Parked" value={data.counts.parked} theme={theme} />
          <Count label="Needs reconciliation" value={data.counts.reconciliation} attention theme={theme} />
          <Count label="Absorbed / promoted" value={data.counts.absorbed + data.counts.promoted} theme={theme} />
        </View>
        {data.counts.recorded > 0 && <DispositionBar counts={data.counts} lowerBound={data.limited} theme={theme} />}
        <Text style={smallStyle(theme)}>{plural(data.counts.displayed, "safe card")} shown from {plural(data.counts.recorded, "recorded heading")}.</Text>
        {data.counts.recorded > 0 ? <>
          <View role="group" accessibilityLabel="Disposition" style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{filters.map((value) => <FilterChip key={value} label={labels[value]} selected={selected === value} onPress={() => setSelection({ workspaceId: state.workspaceId, filter: value })} theme={theme} />)}</View>
          <View style={{ gap: 10 }}>
            <Text style={smallStyle(theme)}>{plural(listed.length, "entry", "entries")} {listed.length === 1 ? "matches" : "match"} this filter{data.counts.displayed < data.counts.recorded ? "; additional headings may lack safe cards" : ""}.</Text>
            {listed.length ? listed.map((item, index) => <Entry key={`${item.id}:${index}`} item={item} theme={theme} compact={compact} />)
              : <Card title="No matching entries" theme={theme}><Text style={textStyle(theme, true)}>No displayed parking-lot entries match this disposition.</Text></Card>}
          </View>
        </> : <Card title="No parked entries" theme={theme}><Text style={textStyle(theme, true)}>The Backlog section is present, but contains no recorded 999.x entries.</Text></Card>}
      </> : <Card title="No parking-lot section" theme={theme}><Text style={textStyle(theme, true)}>The readable current ROADMAP.md has no Backlog section.</Text></Card>}
    </> : <Card title="Parking lot unavailable" theme={theme}><Text style={textStyle(theme, true)}>The current ROADMAP.md could not be read safely.</Text></Card>}
  </BoardFrame>;
}
