import type { RefObject } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import type { BoardFlavor } from "../shared/board-rpc.js";
import type { BoardTheme } from "./board-components.js";

/** GSD Core tabs. */
export const BOARD_TABS = [{ id: "overview", label: "Overview" }, { id: "plans", label: "Plans" }, { id: "context", label: "Context" }, { id: "validation", label: "Validation" }, { id: "verification", label: "Verification" }, { id: "uat", label: "UAT" }, { id: "todos", label: "TODOs" }, { id: "parking", label: "Parking Lot" }, { id: "debug", label: "Debug" }] as const;
/** GSD Path tabs. */
export const PATH_TABS = [{ id: "overview", label: "Overview" }, { id: "tasks", label: "Tasks" }, { id: "reviews", label: "Reviews" }, { id: "questions", label: "Questions" }] as const;
export type BoardTab = typeof BOARD_TABS[number]["id"] | typeof PATH_TABS[number]["id"];
export type TabList = readonly { readonly id: BoardTab; readonly label: string }[];
export type TabFocusTarget = { focus(): void };

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

export function BoardTabs({ tabs = BOARD_TABS, activeTab, focusedTab, onSelect, onFocus, idPrefix, tabRefs, theme, compact }: {
  tabs?: TabList;
  activeTab: BoardTab;
  focusedTab: BoardTab | null;
  onSelect(tab: BoardTab): void;
  onFocus(tab: BoardTab | null): void;
  idPrefix: string;
  tabRefs: RefObject<Partial<Record<BoardTab, TabFocusTarget | null>>>;
  theme: BoardTheme;
  compact: boolean;
}) {
  return <View style={{ paddingHorizontal: compact ? 16 : 24, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 1, borderColor: theme.colors.border ?? theme.colors.foregroundMuted }}>
    <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, width: "100%" }}>
    <View role="tablist" accessibilityLabel="Board sections" style={{ flexDirection: "row", alignSelf: "flex-start", gap: 4, padding: 4, borderRadius: 10, backgroundColor: theme.colors.surface1 ?? theme.colors.surface0 }}>
      {tabs.map((tab) => {
        const selected = activeTab === tab.id;
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
        return <Pressable key={tab.id} ref={(node) => { tabRefs.current[tab.id] = node; }} nativeID={`${idPrefix}-tab-${tab.id}`} role="tab" accessibilityLabel={tab.label} accessibilityState={{ selected }} tabIndex={selected ? 0 : -1} onPress={() => onSelect(tab.id)} onFocus={() => onFocus(tab.id)} onBlur={() => onFocus(null)} {...webProps} style={{ minHeight: 44, minWidth: compact ? 0 : 100, alignItems: "center", justifyContent: "center", paddingHorizontal: compact ? 12 : 16, borderRadius: 7, borderWidth: 2, borderColor: focusedTab === tab.id ? theme.colors.accent : "transparent", backgroundColor: selected ? theme.colors.surface0 : "transparent" }}>
          <Text style={{ color: selected ? theme.colors.foreground : theme.colors.foregroundMuted, fontSize: 14, fontWeight: selected ? "600" : "400" }}>{tab.label}</Text>
        </Pressable>;
      })}
    </View>
    </ScrollView>
  </View>;
}
