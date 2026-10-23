import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { PathPanel, PathRecovery, PathReviewSet, PathWaveReview } from "../shared/path.js";
import type { BoardViewState } from "./board-components.js";
import { Badge, borderColor, Card, PATH_WARNING_COPY, PathFrame, plural, SetupNotice, smallStyle, textStyle, tokenLabel, type ThemeProps } from "./path-components.js";

const negative = new Set(["blocked", "fail", "failed", "not-met", "unverifiable"]);
const isNegative = (verdict: string | null) => negative.has(verdict ?? "");

/** "gpt, muse · 1 actionable · 4 warnings · 0 conflicts" */
export function panelSummary(panel: PathPanel): string {
  return [panel.families.length ? panel.families.join(", ") : "Families not recorded",
    panel.actionable === null ? null : `${panel.actionable} actionable`,
    panel.warnings === null ? null : plural(panel.warnings, "warning"),
    panel.conflicts === null ? null : plural(panel.conflicts, "conflict")].filter(Boolean).join(" · ");
}

export const cycleTitle = (review: PathWaveReview) => `Cycle ${review.cycle}${review.lens ? ` · ${tokenLabel(review.lens)} lens` : ""}`;

function CycleRow({ review, theme }: ThemeProps & { review: PathWaveReview }) {
  const failed = review.tasks.filter((task) => task.verdict === "fail");
  return <View role="listitem" style={{ gap: 6, paddingVertical: 10, borderTopWidth: 1, borderColor: borderColor(theme), opacity: review.superseded ? 0.75 : 1 }}>
    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 8 }}>
      <Text style={{ ...textStyle(theme), fontWeight: "600" }}>{cycleTitle(review)}</Text>
      <Badge label={review.verdict ? `Verdict: ${tokenLabel(review.verdict)}` : "Verdict not recorded"} theme={theme} attention={isNegative(review.verdict) && !review.superseded} />
    </View>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
      {review.superseded && <Badge label="Superseded by a later cycle" theme={theme} />}
      {review.depth && <Badge label={`Depth: ${tokenLabel(review.depth)}`} theme={theme} />}
      {review.tasksReviewed !== null && <Badge label={`${plural(review.tasksReviewed, "task")} reviewed`} theme={theme} />}
      {review.tasks.length > 0 && <Badge label={`${review.tasks.length - failed.length} pass · ${failed.length} fail`} theme={theme} attention={failed.length > 0 && !review.superseded} />}
    </View>
    {failed.length > 0 && <Text style={smallStyle(theme)}>Failed: {failed.map((task) => task.id).join(", ")}</Text>}
    {review.panel && <Text style={smallStyle(theme)}>Panel: {panelSummary(review.panel)}{review.panel.familyFiles.length ? ` · family files: ${review.panel.familyFiles.join(", ")}` : ""}</Text>}
  </View>;
}

/** Wave cycles grouped by wave, newest cycle last. */
export function wavesOf(set: PathReviewSet): [number, PathWaveReview[]][] {
  const groups = new Map<number, PathWaveReview[]>();
  for (const review of set.waves) groups.set(review.wave, [...(groups.get(review.wave) ?? []), review]);
  return [...groups];
}

function ReviewSet({ set, theme }: ThemeProps & { set: PathReviewSet }) {
  return <>
    {set.final && <Card title="Final review" source="review/FINAL.md" theme={theme} attention={isNegative(set.final.verdict)}>
      <Text style={{ ...textStyle(theme), fontWeight: "600" }}>Overall verdict: {tokenLabel(set.final.verdict)}</Text>
      {set.final.criteria.length ? <View role="list" accessibilityLabel="Success criteria verdicts" style={{ gap: 6 }}>
        {set.final.criteria.map((criterion, index) => <View key={criterion.id ?? index} role="listitem" style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 8 }}>
          <Text style={{ ...textStyle(theme), flex: 1, minWidth: 0 }}>{criterion.id ? `${criterion.id} · ` : ""}{criterion.text ?? "Criterion not safely displayable"}</Text>
          <Badge label={tokenLabel(criterion.verdict, "Verdict not recorded")} theme={theme} attention={isNegative(criterion.verdict)} />
        </View>)}
      </View> : <Text style={textStyle(theme, true)}>No success criteria are recorded in the final review.</Text>}
    </Card>}
    {set.gaps.length > 0 && <Card title="Gap reviews" source="review/final-gap-*.md" theme={theme}>
      {set.gaps.map((gap) => <View key={gap.number} style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 8 }}>
        <Text style={textStyle(theme)}>Gap {gap.number}{gap.risk ? ` · ${gap.risk}` : ""}</Text>
        <Badge label={tokenLabel(gap.verdict, "Verdict not recorded")} theme={theme} attention={isNegative(gap.verdict)} />
      </View>)}
    </Card>}
    {set.planPanel && <Card title="Plan panel" source="review/PLAN-PANEL.md" theme={theme}>
      <Text style={textStyle(theme, true)}>{panelSummary(set.planPanel)}</Text>
      {set.planPanel.familyFiles.length > 0 && <Text style={smallStyle(theme)}>Family files: {set.planPanel.familyFiles.join(", ")}</Text>}
    </Card>}
    {wavesOf(set).map(([wave, reviews]) => <Card key={wave} title={`Wave ${wave}`} source={`review/wave-${wave}.cycle*.md`} theme={theme}>
      <View role="list" accessibilityLabel={`Review cycles for wave ${wave}`} style={{ marginTop: -10 }}>{reviews.map((review) => <CycleRow key={`${review.cycle}:${review.lens ?? ""}`} review={review} theme={theme} />)}</View>
    </Card>)}
    {set.patchFindings && <Text style={smallStyle(theme)}>Patch findings are recorded in review/PATCH-FINDINGS.md.</Text>}
    {set.otherFiles.length > 0 && <Text style={smallStyle(theme)}>Other review files: {set.otherFiles.join(", ")}</Text>}
  </>;
}

const isEmpty = (set: PathReviewSet) => !set.waves.length && !set.final && !set.gaps.length && !set.planPanel && !set.patchFindings && !set.otherFiles.length;

/** "Recovery from 0f1e2d3 · 2026-10-22 · reopened Plan" */
export const recoveryTitle = (recovery: PathRecovery) => `Recovery from ${recovery.base}${recovery.date ? ` · ${recovery.date}` : ""}${recovery.kind ? ` · reopened ${tokenLabel(recovery.kind)}` : ""}`;

function RecoveryList({ recoveries, theme, compact }: ThemeProps & { recoveries: readonly PathRecovery[]; compact: boolean }) {
  return <View role="list" accessibilityLabel="Reviews set aside by build recovery" style={{ gap: 12 }}>{recoveries.map((recovery) => <View key={recovery.base} role="listitem" style={{ gap: 12, padding: compact ? 12 : 16, borderRadius: 10, borderWidth: 1, borderColor: borderColor(theme) }}>
    <Text role="heading" style={{ ...textStyle(theme), fontWeight: "600" }}>{recoveryTitle(recovery)}</Text>
    {isEmpty(recovery.reviews) ? <Text style={textStyle(theme, true)}>No readable review files were set aside.</Text> : <ReviewSet set={recovery.reviews} theme={theme} />}
  </View>)}</View>;
}

export function PathReviewsView({ state, onRefresh, theme, compact = false }: ThemeProps & { state: BoardViewState; onRefresh(): void; compact?: boolean }) {
  const [showRecoveries, setShowRecoveries] = useState<{ workspaceId: string; open: boolean } | null>(null);
  const path = state.snapshot?.path;
  const reviews = path?.reviews;
  const recoveriesOpen = showRecoveries?.workspaceId === state.workspaceId && showRecoveries.open;
  const warnings = path?.warnings.filter((warning) => warning.startsWith("reviews-")) ?? [];
  return <PathFrame title="Reviews" description="Wave, panel, final and gap reviews recorded for the current milestone." subject="reviews" state={state} onRefresh={onRefresh} theme={theme} compact={compact}>
    {!path ? <SetupNotice setup="unavailable" theme={theme} /> : path.setup !== "started" ? <SetupNotice setup={path.setup} theme={theme} /> : reviews?.availability === "available" ? <>
      <Text style={smallStyle(theme)}>Verdicts as the reviewers recorded them. A later cycle that recorded a pass or blocked verdict supersedes earlier cycles of its wave.</Text>
      {reviews.limited && <Text role="alert" style={textStyle(theme, true)}>Some review files could not be fully read; the list may be partial.</Text>}
      {warnings.map((warning) => <Text key={warning} style={smallStyle(theme)}>{PATH_WARNING_COPY[warning]}</Text>)}
      {isEmpty(reviews.current) ? <Card title="No reviews yet" theme={theme}><Text style={textStyle(theme, true)}>No review files are recorded for the current milestone.</Text></Card> : <ReviewSet set={reviews.current} theme={theme} />}
      {reviews.recoveries.length > 0 && <View style={{ gap: 12 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${recoveriesOpen ? "Hide" : "Show"} ${plural(reviews.recoveries.length, "review set")} set aside by build recovery`} accessibilityState={{ expanded: recoveriesOpen }} onPress={() => setShowRecoveries({ workspaceId: state.workspaceId, open: !recoveriesOpen })}
          style={{ minHeight: 44, alignSelf: "flex-start", justifyContent: "center", paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: borderColor(theme), backgroundColor: theme.colors.surface1 ?? theme.colors.surface0 }}>
          <Text style={textStyle(theme)}>{recoveriesOpen ? "Hide" : "Show"} {plural(reviews.recoveries.length, "review set")} set aside by build recovery</Text>
        </Pressable>
        {recoveriesOpen && <RecoveryList recoveries={reviews.recoveries} theme={theme} compact={compact} />}
      </View>}
    </> : <Card title={reviews?.availability === "absent" ? "No reviews yet" : "Reviews unavailable"} theme={theme}>
      <Text style={textStyle(theme, true)}>{reviews?.availability === "absent" ? "No review folder yet. GSD Path writes reviews during build and ship." : "The review files could not be read safely."}</Text>
    </Card>}
  </PathFrame>;
}
