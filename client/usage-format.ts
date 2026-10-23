import type { UsageSlot, UsageTotals } from "../shared/usage.js";

/** Figures written the way the GSD Path daemon's dashboard writes them, so both read the same. */

export const DASH = "—";
export const integer = (value: number) => value.toLocaleString("en-US");
export const money = (value: number | null) => value === null ? DASH : `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const tokens = (value: number) => value >= 1e9 ? `${(value / 1e9).toFixed(2)}B` : value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value >= 1e3 ? `${Math.round(value / 1e3)}k` : String(value);
export function duration(seconds: number): string {
  const days = Math.floor(seconds / 86_400), hours = Math.floor((seconds % 86_400) / 3_600), minutes = Math.floor((seconds % 3_600) / 60);
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/** The ten Usage figures: cost, turns, prompts, tokens in, cached, tokens out, cache hit, agent time, cost and time per turn. */
export function usageFigures(totals: UsageTotals): (readonly [string, string])[] {
  const inputs = totals.tokensIn + totals.tokensCached;
  return [
    ["Cost", money(totals.cost)], ["Turns", integer(totals.turns)], ["Prompts", integer(totals.prompts)],
    ["Tokens in", tokens(totals.tokensIn)], ["Cached", tokens(totals.tokensCached)], ["Tokens out", tokens(totals.tokensOut)],
    ["Cache hit", inputs ? `${Math.round(100 * totals.tokensCached / inputs)}%` : DASH],
    ["Agent time", totals.timedTurns ? duration(totals.durationS) : DASH],
    ["Cost / turn", totals.cost !== null && totals.pricedTurns ? money(totals.cost / totals.pricedTurns) : DASH],
    ["Time / turn", totals.timedTurns ? `${Math.round(totals.durationS / totals.timedTurns)}s` : DASH],
  ];
}

/** "$12.50 · 340 turns", or empty when the slot has no turns. */
export const slotSummary = (slot: UsageSlot | undefined) => slot?.turns ? [slot.cost !== null ? money(slot.cost) : null, `${integer(slot.turns)} turns`].filter(Boolean).join(" · ") : "";
