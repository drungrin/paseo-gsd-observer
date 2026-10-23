import { Pressable, Text, View } from "react-native";
import type { LedgerRecord } from "../shared/usage.js";
import type { BoardViewState } from "./board-components.js";
import { borderColor, Card, DataTable, PathFrame, SetupNotice, smallStyle, textStyle, type ThemeProps } from "./path-components.js";
import type { UsageViewState } from "./usage-controller.js";
import { DASH, integer } from "./usage-format.js";

export const LEDGER_COLUMNS = [
  { label: "Time", width: 210 }, { label: "Agent", width: 260 }, { label: "Host", width: 70 }, { label: "Model", width: 250 },
  { label: "Input", width: 90, numeric: true }, { label: "Cached", width: 90, numeric: true }, { label: "Output", width: 80, numeric: true },
  { label: "Seconds", width: 80, numeric: true }, { label: "Cost", width: 80, numeric: true },
] as const;

/** One turn as the daemon's ledger writes it: raw token counts, seconds as recorded, cost in dollars to four places. */
export const ledgerRow = (record: LedgerRecord) => [record.at ?? DASH, record.agent, record.host, record.model ?? "unknown", String(record.tokensIn), String(record.tokensCached), String(record.tokensOut),
  record.durationS === null ? DASH : String(record.durationS), record.cost === null ? DASH : record.cost.toFixed(4)];

function Button({ label, busy, onPress, theme }: ThemeProps & { label: string; busy: boolean; onPress(): void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={onPress}
    style={{ minHeight: 44, alignSelf: "flex-start", justifyContent: "center", paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, borderColor: borderColor(theme), backgroundColor: theme.colors.surface1 ?? theme.colors.surface0 }}>
    <Text style={{ ...textStyle(theme), fontWeight: "500" }}>{busy ? "Loading…" : label}</Text>
  </Pressable>;
}

export function PathLedgerView({ state, usage, onRefresh, onLoadLedger, theme, compact = false }: ThemeProps & { state: BoardViewState; usage: UsageViewState; onRefresh(): void; onLoadLedger(more: boolean): void; compact?: boolean }) {
  const path = state.snapshot?.path;
  const { ledger } = usage;
  return <PathFrame title="Ledger" description="Every host turn recorded inside this workspace, newest first. Loaded only when you ask for it." subject="ledger" state={state} onRefresh={onRefresh} theme={theme} compact={compact}>
    {!path ? <SetupNotice setup="unavailable" theme={theme} /> : !ledger.loaded ? <Card title="Host turn ledger" source="Claude Code and Codex session logs" theme={theme}>
      <Text style={textStyle(theme, true)}>Lists each turn with its agent, model, tokens, time and cost. Reading every session log can take a moment.</Text>
      {ledger.error && <Text role="alert" style={textStyle(theme)}>{ledger.error}</Text>}
      <Button label="Load host turn ledger" busy={ledger.loading} onPress={() => onLoadLedger(false)} theme={theme} />
    </Card> : ledger.total === 0 ? <Card title="No host turns" theme={theme}>
      <Text style={textStyle(theme, true)}>No Claude Code or Codex session recorded a working directory inside this workspace.</Text>
    </Card> : <>
      <Text style={smallStyle(theme)}>Showing {integer(ledger.records.length)} of {integer(ledger.total)} turns, newest first.{ledger.complete ? "" : " Some session logs were still being read; refresh for the rest."}</Text>
      {ledger.error && <Text role="alert" style={textStyle(theme)}>{ledger.error}</Text>}
      <DataTable label="Host turn ledger" columns={LEDGER_COLUMNS} rows={ledger.records.map(ledgerRow)} theme={theme} />
      {ledger.records.length < ledger.total && <Button label={`Load ${integer(Math.min(200, ledger.total - ledger.records.length))} more`} busy={ledger.loading} onPress={() => onLoadLedger(true)} theme={theme} />}
      <View style={{ gap: 4 }}>
        <Text style={smallStyle(theme)}>Input counts new and cache-written tokens; cached counts cache reads. Seconds run from the request to the response's last block. Costs use the GSD Path daemon's price table; a dash means the model has no price.</Text>
      </View>
    </>}
  </PathFrame>;
}
