import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { BoardPath, PathPanel, PathRecovery, PathReviewSet, PathWaveReview } from "../shared/path.js";
import type { BoardViewState } from "./board-components.js";
import { PathFrame, plural, SetupNotice, textStyle, tokenLabel, warningAlerts, type ThemeProps } from "./path-components.js";
import { kicker, line, figures, Pill, Section, Stat, surface, text, tint, toneColor, type Tone } from "./ui-kit.js";

const negative = new Set(["blocked", "fail", "failed", "not-met", "unverifiable"]);
const isNegative = (verdict: string | null) => negative.has(verdict ?? "");
const positive = new Set(["pass", "met", "passed", "approved"]);
const isPositive = (verdict: string | null) => positive.has(verdict ?? "");
const verdictTone = (verdict: string | null): Tone => !verdict ? "neutral" : isNegative(verdict) ? "danger" : isPositive(verdict) ? "success" : "warning";
const verdictGlyph = (verdict: string | null) => !verdict ? "?" : isNegative(verdict) ? "✕" : isPositive(verdict) ? "✓" : "!";

/** The last cycle of each wave and lens that the later ones have not superseded: what each review currently says. */
export function latestCycles(set: PathReviewSet): PathWaveReview[] {
  const latest = new Map<string, PathWaveReview>();
  for (const review of set.waves) if (!review.superseded) latest.set(`${review.wave}:${review.lens ?? ""}`, review);
  return [...latest.values()];
}

/** "gpt, muse · 1 actionable · 4 warnings · 0 conflicts" */
export function panelSummary(panel: PathPanel): string {
  return [panel.families.length ? panel.families.join(", ") : "Families not recorded",
    panel.actionable === null ? null : `${panel.actionable} actionable`,
    panel.warnings === null ? null : plural(panel.warnings, "warning"),
    panel.conflicts === null ? null : plural(panel.conflicts, "conflict")].filter(Boolean).join(" · ");
}

export const cycleTitle = (review: PathWaveReview) => `Cycle ${review.cycle}${review.lens ? ` · ${tokenLabel(review.lens)} lens` : ""}`;

/** Wave cycles grouped by wave, newest cycle last. */
export function wavesOf(set: PathReviewSet): [number, PathWaveReview[]][] {
  const groups = new Map<number, PathWaveReview[]>();
  for (const review of set.waves) groups.set(review.wave, [...(groups.get(review.wave) ?? []), review]);
  return [...groups];
}

function PanelFigures({ panel, theme }: ThemeProps & { panel: PathPanel }) {
  return <View style={{ flexDirection: "row", columnGap: 8, rowGap: 2, flexWrap: "wrap" }}>
    {([["actionable", panel.actionable, "danger"], ["warnings", panel.warnings, "warning"], ["conflicts", panel.conflicts, "warning"]] as const).map(([label, value, tone]) => <Text key={label} style={{ ...text(theme, 12, "500", !value), ...figures, color: value ? toneColor(theme, tone) : theme.colors.foregroundMuted }}>{value ?? "—"} {value === 1 ? label.replace(/s$/, "") : label}</Text>)}
  </View>;
}

function CycleNode({ review, latest, theme }: ThemeProps & { review: PathWaveReview; latest: boolean }) {
  const tone = verdictTone(review.verdict);
  const color = toneColor(theme, tone);
  const failed = review.tasks.filter((task) => task.verdict === "fail");
  return <View accessible accessibilityLabel={`${cycleTitle(review)}: ${review.verdict ?? "verdict not recorded"}${review.superseded ? ", superseded by a later cycle" : ""}${review.panel ? `. Panel: ${panelSummary(review.panel)}` : ""}`} style={{ width: 214, padding: 14, gap: 8, borderRadius: 14, backgroundColor: review.superseded ? surface(theme, 2) : tint(theme, color, 0.12), borderWidth: latest && !review.superseded ? 2 : 0, borderColor: color, opacity: review.superseded ? 0.62 : 1 }}>
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
      <Text style={kicker(theme)}>{cycleTitle(review)}</Text>
      {review.superseded && <Text style={text(theme, 10, "500", true)}>superseded</Text>}
    </View>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <View style={{ width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: tint(theme, color, 0.25) }}><Text style={{ ...text(theme, 14, "700"), color }}>{verdictGlyph(review.verdict)}</Text></View>
      <Text style={{ ...text(theme, 18, "700"), color: tone === "neutral" ? theme.colors.foreground : color }}>{tokenLabel(review.verdict, "No verdict")}</Text>
    </View>
    <Text style={{ ...text(theme, 12, "400", true), ...figures }}>{[review.tasksReviewed !== null ? plural(review.tasksReviewed, "task") : null, review.depth ? `${review.depth} depth` : null, review.tasks.length ? `${review.tasks.length - failed.length} pass · ${failed.length} fail` : null].filter(Boolean).join(" · ")}</Text>
    {review.panel && <>
      <PanelFigures panel={review.panel} theme={theme} />
      <Text style={text(theme, 12, "400", true)}>Panel: {review.panel.families.length ? review.panel.families.join(", ") : "families not recorded"}{review.panel.familyFiles.length ? ` · family files: ${review.panel.familyFiles.join(", ")}` : ""}</Text>
    </>}
    {failed.length > 0 && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>{failed.slice(0, 8).map((task) => <Pill key={task.id} theme={theme} tone="danger" label={task.id} />)}</View>}
  </View>;
}

function Arrow({ theme }: ThemeProps) {
  return <View style={{ width: 28, alignSelf: "center", alignItems: "center" }}><Text style={{ ...text(theme, 18, "400", true) }}>→</Text></View>;
}

function WaveChain({ wave, reviews, name, theme }: ThemeProps & { wave: number; reviews: PathWaveReview[]; name: string | null }) {
  const lenses = new Map<string, PathWaveReview[]>();
  for (const review of reviews) lenses.set(review.lens ?? "", [...(lenses.get(review.lens ?? "") ?? []), review]);
  // A wave with several lenses is blocked while any lens's latest cycle is, and passes only when every lens's does.
  const current = latestCycles({ waves: reviews, planPanel: null, final: null, gaps: [], patchFindings: false, otherFiles: [] });
  const latest = current.find((review) => isNegative(review.verdict)) ?? (current.length && current.every((review) => isPositive(review.verdict)) ? current[current.length - 1] : current.find((review) => !isPositive(review.verdict)));
  const tone = verdictTone(latest?.verdict ?? null);
  const cycles = Math.max(...reviews.map((review) => review.cycle));
  return <Section theme={theme} gap={12}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <Text style={{ ...text(theme, 20, "700"), ...figures }}>W{wave}</Text>
      {name && <Text style={text(theme, 14, "600")}>{name}</Text>}
      <Pill theme={theme} tone={tone} glyph={verdictGlyph(latest?.verdict ?? null)} label={latest ? `${tokenLabel(latest.verdict, "No verdict")} after ${plural(cycles, "cycle")}` : "No verdict"} strong />
    </View>
    {[...lenses].map(([lens, chain]) => <View key={lens} style={{ gap: 6 }}>
      {lens && <Text style={kicker(theme)}>{tokenLabel(lens)} lens</Text>}
      <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 10 }}>
        {chain.map((review, index) => <View key={`${review.cycle}`} style={{ flexDirection: "row" }}>
          {index > 0 && <Arrow theme={theme} />}
          <CycleNode review={review} latest={review === chain.filter((entry) => !entry.superseded).at(-1)} theme={theme} />
        </View>)}
      </View>
    </View>)}
  </Section>;
}

function ReviewSet({ set, waveNames, theme }: ThemeProps & { set: PathReviewSet; waveNames: Map<number, string | null> }) {
  return <View style={{ gap: 14 }}>
    {set.final && <Section theme={theme} tone={verdictTone(set.final.verdict) === "neutral" ? undefined : verdictTone(set.final.verdict)} overline="Final review · review/FINAL.md" gap={12}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Text style={{ ...text(theme, 26, "700"), color: toneColor(theme, verdictTone(set.final.verdict)) }}>{verdictGlyph(set.final.verdict)} {tokenLabel(set.final.verdict, "No verdict")}</Text>
        <Text style={text(theme, 13, "400", true)}>{set.final.criteria.filter((criterion) => isPositive(criterion.verdict)).length} of {plural(set.final.criteria.length, "criterion", "criteria")} recorded as met</Text>
      </View>
      {set.final.criteria.map((criterion, index) => <View key={criterion.id ?? index} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start", paddingVertical: 4, borderTopWidth: index ? 1 : 0, borderColor: line(theme) }}>
        <Text style={{ ...text(theme, 14, "700"), color: toneColor(theme, verdictTone(criterion.verdict)), width: 18 }}>{verdictGlyph(criterion.verdict)}</Text>
        <Text style={{ ...text(theme, 13), flex: 1 }}>{criterion.id ? <Text style={text(theme, 13, "700")}>{criterion.id}  </Text> : null}{criterion.text ?? "Criterion not safely displayable"}</Text>
        <Text style={text(theme, 12, "500", true)}>{tokenLabel(criterion.verdict, "—")}</Text>
      </View>)}
    </Section>}
    {set.gaps.length > 0 && <Section theme={theme} overline="Gap reviews · review/final-gap-*.md" gap={8}>
      {set.gaps.map((gap) => <View key={gap.number} style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
        <Text style={text(theme, 13)}>Gap {gap.number}{gap.risk ? ` · ${gap.risk}` : ""}</Text>
        <Pill theme={theme} tone={verdictTone(gap.verdict)} label={tokenLabel(gap.verdict, "No verdict")} />
      </View>)}
    </Section>}
    {set.planPanel && <Section theme={theme} overline="Plan review · review/PLAN-PANEL.md" gap={10}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Text style={text(theme, 15, "600")}>Panel</Text>
        {set.planPanel.families.map((family) => <Pill key={family} theme={theme} label={family} />)}
      </View>
      <PanelFigures panel={set.planPanel} theme={theme} />
    </Section>}
    {wavesOf(set).map(([wave, reviews]) => <WaveChain key={wave} wave={wave} reviews={reviews} name={waveNames.get(wave) ?? null} theme={theme} />)}
    {set.patchFindings && <Text style={text(theme, 12, "400", true)}>Patch findings are recorded in review/PATCH-FINDINGS.md.</Text>}
    {set.otherFiles.length > 0 && <Text style={text(theme, 12, "400", true)}>Other review files: {set.otherFiles.join(", ")}</Text>}
  </View>;
}

const isEmpty = (set: PathReviewSet) => !set.waves.length && !set.final && !set.gaps.length && !set.planPanel && !set.patchFindings && !set.otherFiles.length;

/** "Recovery from 0f1e2d3 · 2026-10-22 · reopened Plan" */
export const recoveryTitle = (recovery: PathRecovery) => `Recovery from ${recovery.base}${recovery.date ? ` · ${recovery.date}` : ""}${recovery.kind ? ` · reopened ${tokenLabel(recovery.kind)}` : ""}`;

/** The caveats behind the reviews tab. */
export function reviewsNotes(): string[] {
  return [
    "Verdicts as the reviewers recorded them. Among cycles of one wave and lens that recorded pass or blocked, only the latest is current; earlier ones are faded as superseded.",
  ];
}

/** What qualifies the reviews shown: a partial read and the review warnings. */
export const reviewsAlerts = (path: BoardPath | undefined) => [...(path?.reviews.limited ? ["Some review files could not be fully read; the list may be partial."] : []), ...warningAlerts(path, (warning) => warning.startsWith("reviews-"))];

export function PathReviewsView({ state, onRefresh, theme, compact = false }: ThemeProps & { state: BoardViewState; onRefresh(): void; compact?: boolean }) {
  const [showRecoveries, setShowRecoveries] = useState<{ workspaceId: string; open: boolean } | null>(null);
  const path = state.snapshot?.path;
  const reviews = path?.reviews;
  const waveNames = new Map((path?.tasks.waves ?? []).map((wave) => [wave.number, wave.name]));
  const recoveriesOpen = showRecoveries?.workspaceId === state.workspaceId && showRecoveries.open;
  const current = reviews?.current;
  const cycles = current?.waves.length ?? 0;
  const blocked = current?.waves.filter((review) => isNegative(review.verdict)).length ?? 0;
  const latest = current ? latestCycles(current) : [];
  const open = latest.filter((review) => isNegative(review.verdict)).length;
  const passing = latest.length > 0 && latest.every((review) => isPositive(review.verdict));
  const openDetail = open ? "waiting on fixes" : !latest.length ? "no review cycle recorded" : passing ? "every wave's latest cycle passes" : "some latest cycles record no pass";
  return <PathFrame title="Reviews" description="How each wave got through review: every cycle, its verdict, and what it sent back." subject="reviews" state={state} onRefresh={onRefresh} theme={theme} compact={compact} alerts={reviewsAlerts(path)} notes={reviewsNotes()}>
    {!path ? <SetupNotice setup="unavailable" theme={theme} /> : path.setup !== "started" ? <SetupNotice setup={path.setup} theme={theme} /> : reviews?.availability === "available" && current ? <>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <Stat theme={theme} size={22} label="Review cycles" value={String(cycles)} detail={`${plural(wavesOf(current).length, "wave")} reviewed`} />
        <Stat theme={theme} size={22} label="Sent back" value={String(blocked)} detail="cycles that blocked" tone={blocked ? "warning" : undefined} />
        <Stat theme={theme} size={22} label="Open blocks" value={String(open)} detail={openDetail} tone={open ? "danger" : passing ? "success" : undefined} />
        <Stat theme={theme} size={22} label="Final review" value={current.final ? tokenLabel(current.final.verdict, "Recorded") : "Not yet"} tone={current.final ? verdictTone(current.final.verdict) === "neutral" ? undefined : verdictTone(current.final.verdict) : undefined} />
      </View>
      {isEmpty(current) ? <Section theme={theme} title="No reviews yet"><Text style={text(theme, 13, "400", true)}>No review files are recorded for the current milestone.</Text></Section> : <ReviewSet set={current} waveNames={waveNames} theme={theme} />}
      {reviews.recoveries.length > 0 && <View style={{ gap: 12 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${recoveriesOpen ? "Hide" : "Show"} ${plural(reviews.recoveries.length, "review set")} set aside by build recovery`} accessibilityState={{ expanded: recoveriesOpen }} onPress={() => setShowRecoveries({ workspaceId: state.workspaceId, open: !recoveriesOpen })} style={{ alignSelf: "flex-start", paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: surface(theme, 2) }}>
          <Text style={text(theme, 13, "500")}>{recoveriesOpen ? "▾" : "▸"}  {plural(reviews.recoveries.length, "review set")} set aside by build recovery</Text>
        </Pressable>
        {recoveriesOpen && reviews.recoveries.map((recovery) => <View key={recovery.base} style={{ gap: 10, paddingLeft: 14, borderLeftWidth: 2, borderColor: line(theme) }}>
          <Text style={text(theme, 14, "600")}>{recoveryTitle(recovery)}</Text>
          {isEmpty(recovery.reviews) ? <Text style={textStyle(theme, true)}>No readable review files were set aside.</Text> : <ReviewSet set={recovery.reviews} waveNames={waveNames} theme={theme} />}
        </View>)}
      </View>}
    </> : <Section theme={theme} title={reviews?.availability === "absent" ? "No reviews yet" : "Reviews unavailable"}>
      <Text style={text(theme, 13, "400", true)}>{reviews?.availability === "absent" ? "No review folder yet. GSD Path writes reviews during build and ship." : "The review files could not be read safely."}</Text>
    </Section>}
  </PathFrame>;
}
