import type { RefObject } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import type { BoardFlavor } from "../shared/board-rpc.js";
import type { BoardPath } from "../shared/path.js";
import type { BoardTheme } from "./board-components.js";
import { tint, toneColor, type Tone } from "./ui-kit.js";

/** GSD Core tabs. */
export const BOARD_TABS = [{ id: "overview", label: "Overview" }, { id: "plans", label: "Plans" }, { id: "timeline", label: "Timeline" }, { id: "context", label: "Context" }, { id: "validation", label: "Validation" }, { id: "verification", label: "Verification" }, { id: "uat", label: "UAT" }, { id: "todos", label: "TODOs" }, { id: "parking", label: "Parking Lot" }, { id: "debug", label: "Debug" }, { id: "ledger", label: "Ledger" }] as const;
/** GSD Path tabs. */
export const PATH_TABS = [{ id: "overview", label: "Overview" }, { id: "tasks", label: "Tasks" }, { id: "timeline", label: "Timeline" }, { id: "reviews", label: "Reviews" }, { id: "roadmap", label: "Roadmap" }, { id: "questions", label: "Questions" }, { id: "ledger", label: "Ledger" }] as const;
export type BoardTab = typeof BOARD_TABS[number]["id"] | typeof PATH_TABS[number]["id"];
export type TabList = readonly { readonly id: BoardTab; readonly label: string }[];
export type TabFocusTarget = { focus(): void };
/** A short figure beside a tab's label, colored when it asks for attention. */
export type TabBadge = { label: string; tone?: Tone };

const NEGATIVE_VERDICTS = new Set(["blocked", "fail", "failed", "not-met", "unverifiable"]);

/** Task progress, open review blocks, roadmap progress and pending questions, beside the GSD Path tabs they belong to. */
export function pathBadges(path: BoardPath | undefined): Partial<Record<BoardTab, TabBadge>> {
  if (!path || path.setup !== "started") return {};
  const { tasks, roadmap, questions, reviews } = path;
  const failed = tasks.counts.failed + tasks.counts.blocked;
  const blocked = reviews.current.waves.filter((review) => !review.superseded && NEGATIVE_VERDICTS.has(review.verdict ?? "")).length;
  return {
    ...(tasks.availability === "available" && tasks.counts.total ? { tasks: { label: `${tasks.counts.done}/${tasks.counts.total}`, tone: failed ? "danger" : tasks.counts.done === tasks.counts.total ? "success" : "neutral" } } : {}),
    ...(blocked ? { reviews: { label: `${blocked} blocked`, tone: "danger" } } : {}),
    ...(roadmap.availability === "available" && roadmap.counts.total ? { roadmap: { label: `${roadmap.counts.shipped}/${roadmap.counts.total}` } } : {}),
    ...(questions.counts.pending ? { questions: { label: String(questions.counts.pending), tone: "warning" } } : {}),
  };
}

/** The tabs for the workspace's pipeline; until a workspace has been read, only Overview, so no other pipeline's tabs flash first. */
export const tabsFor = (flavor: BoardFlavor | undefined): TabList => flavor === "gsd-path" ? PATH_TABS : flavor === "gsd-core" ? BOARD_TABS : [BOARD_TABS[0]];

type TabKeyEvent = { key?: string; nativeEvent?: { key?: string }; preventDefault(): void };

export function tabForKey(activeTab: BoardTab, key: string, tabs: TabList = BOARD_TABS): BoardTab | null {
  const index = tabs.findIndex((tab) => tab.id === activeTab);
  if (key === "Home") return tabs[0].id;
  if (key === "End") return tabs[tabs.length - 1].id;
  if (key === "ArrowRight") return tabs[(index + 1) % tabs.length].id;
  if (key === "ArrowLeft") return tabs[(index + tabs.length - 1) % tabs.length].id;
  return null;
}

export function BoardTabs({ tabs = BOARD_TABS, badges = {}, activeTab, focusedTab, onSelect, onFocus, idPrefix, tabRefs, theme, compact }: {
  tabs?: TabList;
  badges?: Partial<Record<BoardTab, TabBadge>>;
  activeTab: BoardTab;
  focusedTab: BoardTab | null;
  onSelect(tab: BoardTab): void;
  onFocus(tab: BoardTab | null): void;
  idPrefix: string;
  tabRefs: RefObject<Partial<Record<BoardTab, TabFocusTarget | null>>>;
  theme: BoardTheme;
  compact: boolean;
}) {
  const muted = theme.colors.foregroundMuted;
  const accent = toneColor(theme, "accent");
  return <View style={{ paddingHorizontal: compact ? 12 : 20, paddingTop: 10, borderBottomWidth: 1, borderColor: theme.colors.border ?? muted }}>
    <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, width: "100%" }}>
    <View role="tablist" accessibilityLabel="Board sections" style={{ flexDirection: "row", alignSelf: "flex-start", gap: compact ? 2 : 6 }}>
      {tabs.map((tab) => {
        const selected = activeTab === tab.id;
        const badge = badges[tab.id];
        const badgeColor = badge?.tone && badge.tone !== "neutral" ? toneColor(theme, badge.tone) : muted;
        const webProps = Platform.OS === "web" ? {
          "aria-controls": `${idPrefix}-panel-${tab.id}`,
          "aria-selected": selected,
          onKeyDown: (event: TabKeyEvent) => {
            const next = tabForKey(tab.id, event.key ?? event.nativeEvent?.key ?? "", tabs);
            if (!next) return;
            event.preventDefault();
            onSelect(next);
            tabRefs.current[next]?.focus();
          },
        } : {};
        // React Native Web reports hover to the style callback; native platforms never set it.
        return <Pressable key={tab.id} ref={(node) => { tabRefs.current[tab.id] = node; }} nativeID={`${idPrefix}-tab-${tab.id}`} role="tab" accessibilityLabel={tab.label} accessibilityHint={badge?.label} accessibilityState={{ selected }} tabIndex={selected ? 0 : -1} onPress={() => onSelect(tab.id)} onFocus={() => onFocus(tab.id)} onBlur={() => onFocus(null)} {...webProps}
          // The selected tab is underlined; the focused one is ringed, so keyboard focus shows even on the selected tab.
          style={(state) => ({ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: compact ? 10 : 12, marginBottom: -1, borderWidth: 2, borderRadius: 8, borderBottomLeftRadius: 0, borderBottomRightRadius: 0,
            borderColor: focusedTab === tab.id ? accent : "transparent", borderBottomColor: selected || focusedTab === tab.id ? accent : "transparent", backgroundColor: (state as { hovered?: boolean }).hovered && !selected ? tint(theme, muted, 0.08) : "transparent" })}>
          <Text style={{ color: selected ? theme.colors.foreground : muted, fontSize: 14, fontWeight: selected ? "600" : "500" }}>{tab.label}</Text>
          {badge && <Text style={{ color: badgeColor, fontSize: 11, fontWeight: "600", fontVariant: ["tabular-nums"], paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, overflow: "hidden", backgroundColor: tint(theme, badgeColor, badge.tone && badge.tone !== "neutral" ? 0.16 : 0.12) }}>{badge.label}</Text>}
        </Pressable>;
      })}
    </View>
    </ScrollView>
  </View>;
}
