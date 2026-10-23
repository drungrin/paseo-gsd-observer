import { Text, View } from "react-native";
import type { BoardUsage } from "../shared/usage.js";
import { borderColor, Card, DataTable, smallStyle, textStyle, type ThemeProps } from "./path-components.js";
import type { UsageViewState } from "./usage-controller.js";
import { integer, money, tokens, usageFigures } from "./usage-format.js";

/** Where the figures come from, folded with a tab's notes. */
export const USAGE_SOURCE = "From Claude Code and Codex session logs whose working directory is inside this workspace, read as the GSD Path daemon reads them.";

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
