import type { RefObject } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import type { BoardTheme } from "./board-components.js";

export const BOARD_TABS = [{ id: "overview", label: "Overview" }, { id: "plans", label: "Plans" }, { id: "context", label: "Context" }, { id: "validation", label: "Validation" }, { id: "verification", label: "Verification" }, { id: "uat", label: "UAT" }, { id: "todos", label: "TODOs" }, { id: "parking", label: "Parking Lot" }, { id: "debug", label: "Debug" }] as const;
export type BoardTab = typeof BOARD_TABS[number]["id"];
export type TabFocusTarget = { focus(): void };

type TabKeyEvent = { key?: string; nativeEvent?: { key?: string }; preventDefault(): void };

export function tabForKey(activeTab: BoardTab, key: string): BoardTab | null {
  const index = BOARD_TABS.findIndex((tab) => tab.id === activeTab);
  if (key === "Home") return BOARD_TABS[0].id;
  if (key === "End") return BOARD_TABS[BOARD_TABS.length - 1].id;
  if (key === "ArrowRight") return BOARD_TABS[(index + 1) % BOARD_TABS.length].id;
  if (key === "ArrowLeft") return BOARD_TABS[(index + BOARD_TABS.length - 1) % BOARD_TABS.length].id;
  return null;
}

export function BoardTabs({ activeTab, focusedTab, onSelect, onFocus, idPrefix, tabRefs, theme, compact }: {
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
      {BOARD_TABS.map((tab) => {
        const selected = activeTab === tab.id;
        const webProps = Platform.OS === "web" ? {
          "aria-controls": `${idPrefix}-panel-${tab.id}`,
          "aria-selected": selected,
          onKeyDown: (event: TabKeyEvent) => {
            const next = tabForKey(tab.id, event.key ?? event.nativeEvent?.key ?? "");
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
