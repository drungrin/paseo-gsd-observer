import { Text, View } from "react-native";
import type { BoardUsage, UsageTotals } from "../shared/usage.js";
import { borderColor, Card, DataTable, plural, smallStyle, textStyle, type ThemeProps } from "./board-frame.js";
import { BarRow, kicker, Legend, SegmentBar, Stat, text, tint, toneColor } from "./ui-kit.js";
import type { UsageViewState } from "./usage-controller.js";
import { duration, integer, money, tokens, usageFigures } from "./usage-format.js";

/** Where the figures come from, folded with a tab's notes. */
export const USAGE_SOURCE = "From Claude Code and Codex session logs whose working directory is inside this workspace, read as the GSD Path daemon reads them.";
/** The same for a GSD Core workspace, whose agents are placed by GSD Core's own marks. */
export const CORE_USAGE_SOURCE = "From Claude Code and Codex session logs whose working directory is inside this workspace. Tokens and costs are counted as the GSD Path daemon counts them; each turn is placed by the plan or phase its GSD agent names, or with the orchestrator. Codex records the tasks of agents other than executors encrypted, so those are not placed in a phase.";

/** What changes how the figures read: missing prices, a read still in progress, a session folder read only in part. Shown, not folded. */
export function usageQualifiers(usage: BoardUsage): string[] {
  return [
    ...(usage.pricing === "missing" ? ["No price table was found in the GSD Path daemon's configuration, so costs are not shown."] : []),
    ...(usage.unpriced.length ? [`No price is configured for ${usage.unpriced.join(", ")}: tokens counted, cost excluded.`] : []),
    ...(usage.complete ? [] : ["Still reading host session logs; the figures will grow."]),
    ...(usage.limited ? ["A session folder holds more entries than the observer walks, so these figures cover only part of it."] : []),
  ];
}

/** The qualifiers of the figures a tab shows, with a failed refresh that left the last figures up. */
export const usageAlerts = (view: UsageViewState) => [
  ...(view.usage?.availability === "available" ? usageQualifiers(view.usage) : []),
  ...(view.error && view.usage ? ["Could not refresh host usage; the last figures are still displayed."] : []),
];

/** What to say when there are no figures to show yet, or null when there are. */
export function usageNotice(view: UsageViewState): string | null {
  if (view.error && !view.usage) return "Host usage could not be read.";
  if (!view.usage) return "Reading host session logs…";
  if (view.usage.availability === "unavailable") return "Host usage could not be read for this workspace.";
  if (view.usage.availability === "none") return "No Claude Code or Codex session recorded a working directory inside this workspace.";
  return null;
}

export function UsageCard({ view, theme }: ThemeProps & { view: UsageViewState }) {
  const notice = usageNotice(view);
  const usage = view.usage;
  return <Card title="Usage" source="Claude Code and Codex session logs" theme={theme}>
    {notice || !usage ? <Text accessibilityLiveRegion="polite" style={textStyle(theme, true)}>{notice}</Text> : <>
      <View accessibilityLabel="Usage figures" style={{ flexDirection: "row", flexWrap: "wrap", borderWidth: 1, borderColor: borderColor(theme), borderRadius: 10, overflow: "hidden" }}>
        {usageFigures(usage.totals).map(([label, value]) => <View key={label} accessible accessibilityLabel={`${label}: ${value}`} style={{ flexBasis: 130, flexGrow: 1, padding: 12, gap: 2, borderColor: borderColor(theme), borderRightWidth: 1, borderBottomWidth: 1 }}>
          <Text style={smallStyle(theme)}>{label}</Text>
          <Text style={{ ...textStyle(theme), fontSize: 18, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{value}</Text>
        </View>)}
      </View>
      {usage.models.length > 0 && <View style={{ gap: 8 }}>
        <Text role="heading" style={{ ...textStyle(theme), fontWeight: "600" }}>Models</Text>
        <DataTable label="Usage by model" theme={theme}
          columns={[{ label: "Model", width: 280 }, { label: "Host", width: 80 }, { label: "Turns", width: 80, numeric: true }, { label: "Tokens", width: 90, numeric: true }, { label: "Cost", width: 90, numeric: true }]}
          rows={usage.models.map((model) => [model.model ?? "unknown", model.host, integer(model.turns), tokens(model.tokens), money(model.cost)])} />
      </View>}
    </>}
  </Card>;
}

/** The headline usage figures: spent, agent time, turns and cache hit; or what to say while there are none. */
export function UsageFigures({ usage, theme }: ThemeProps & { usage: UsageViewState }) {
  const value = usage.usage?.availability === "available" ? usage.usage : null;
  if (!value) return <Text accessibilityLiveRegion="polite" style={text(theme, 13, "400", true)}>{usageNotice(usage)}</Text>;
  const { totals } = value;
  const inputs = totals.tokensIn + totals.tokensCached;
  const hit = inputs ? totals.tokensCached / inputs : null;
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
    <Stat theme={theme} label="Spent" value={money(totals.cost)} detail={totals.cost !== null && totals.pricedTurns ? `${money(totals.cost / totals.pricedTurns)} per turn` : value.pricing === "missing" ? "No price table" : "No model has a price"} />
    <Stat theme={theme} label="Agent time" value={totals.timedTurns ? duration(totals.durationS) : "—"} detail={totals.timedTurns ? `${Math.round(totals.durationS / totals.timedTurns)}s per turn` : null} />
    <Stat theme={theme} label="Turns" value={integer(totals.turns)} detail={`${integer(totals.prompts)} prompts · ${plural(value.sessions, "session log")}`} />
    <Stat theme={theme} label="Cache hit" value={hit === null ? "—" : `${Math.round(100 * hit)}%`} detail={`${tokens(totals.tokensIn + totals.tokensCached + totals.tokensOut)} tokens`} tone={hit !== null && hit >= 0.8 ? "success" : undefined} />
  </View>;
}


/** The workspace's tokens as cached reads, new input and output. */
export function TokenMix({ totals, theme }: ThemeProps & { totals: UsageTotals }) {
  const cached = tint(theme, toneColor(theme, "success"), 0.7);
  return <View style={{ gap: 8 }}>
    <Text style={kicker(theme)}>Token mix</Text>
    <SegmentBar theme={theme} height={14} label={`${tokens(totals.tokensCached)} cached reads, ${tokens(totals.tokensIn)} new input, ${tokens(totals.tokensOut)} output`} segments={[
      { label: "cached", value: totals.tokensCached, color: cached }, { label: "input", value: totals.tokensIn, color: toneColor(theme, "accent") }, { label: "output", value: totals.tokensOut, color: toneColor(theme, "warning") },
    ]} />
    <Legend theme={theme} items={[{ color: cached, label: `${tokens(totals.tokensCached)} cached reads` }, { color: toneColor(theme, "accent"), label: `${tokens(totals.tokensIn)} new input` }, { color: toneColor(theme, "warning"), label: `${tokens(totals.tokensOut)} output` }]} />
  </View>;
}

/** The four costliest models as bars. */
export function ModelBars({ usage, theme }: ThemeProps & { usage: BoardUsage }) {
  const models = usage.models.filter((model) => model.cost).slice(0, 4);
  const top = Math.max(0, ...models.map((model) => model.cost ?? 0));
  if (!models.length) return null;
  return <View style={{ gap: 10 }}>
    <Text style={kicker(theme)}>Models</Text>
    {models.map((model) => <BarRow key={`${model.model}:${model.host}`} theme={theme} label={model.model ?? "unknown"} detail={`${integer(model.turns)} turns`} value={model.cost ?? 0} max={top} figure={money(model.cost)} color={tint(theme, theme.colors.foregroundMuted, 0.6)} />)}
  </View>;
}
