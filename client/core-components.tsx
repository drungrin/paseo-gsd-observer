import { Platform, Pressable, Text, View } from "react-native";
import type { ThemeProps } from "./board-frame.js";
import { figures, Pulse, surface, text, tint, toneColor, type Tone } from "./ui-kit.js";

/** Pieces the GSD Core tabs share. */

/** A phase as one chip of a picker: a short status line, an optional fill, and the full description screen readers hear. */
export type PickerPhase = { id: string; current: boolean; tone: Tone | null; detail: string; percent?: number | null; description: string };

const glyph = (tone: Tone | null) => tone === "success" ? "✓" : tone === "danger" ? "✕" : tone === "warning" ? "!" : null;

function PhaseChip({ phase, selected, onPress, theme }: ThemeProps & { phase: PickerPhase; selected: boolean; onPress(): void }) {
  const accent = toneColor(theme, "accent");
  const mark = glyph(phase.tone);
  return <Pressable role="button" accessibilityState={{ selected }} {...(Platform.OS === "web" ? { "aria-pressed": selected } : {})} accessibilityLabel={`Phase ${phase.id}${phase.current ? ", current" : ""}: ${phase.description}`} onPress={onPress}
    // React Native Web reports hover to the style callback; native platforms never set it.
    style={(state) => ({ minWidth: 92, maxWidth: 180, minHeight: 56, paddingHorizontal: 10, paddingVertical: 8, gap: 4, justifyContent: "space-between", borderRadius: 12, backgroundColor: selected ? tint(theme, accent, 0.16) : surface(theme), borderWidth: selected ? 2 : 1, borderColor: selected ? accent : phase.current ? tint(theme, accent, 0.6) : "transparent", transform: [{ translateY: (state as { hovered?: boolean }).hovered ? -2 : 0 }] })}>
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
      <Text numberOfLines={1} style={{ ...text(theme, 13, "700"), ...figures }}>{phase.id}</Text>
      {mark ? <Text style={{ ...text(theme, 12, "700"), color: toneColor(theme, phase.tone!) }}>{mark}</Text> : phase.current ? <View style={{ margin: -6 }}><Pulse color={accent} size={6} /></View> : null}
    </View>
    <Text numberOfLines={1} style={{ ...text(theme, 11, "500", true), ...figures, ...(phase.tone && phase.tone !== "success" ? { color: toneColor(theme, phase.tone) } : {}) }}>{phase.detail}</Text>
    {phase.percent !== undefined && <View style={{ height: 3, borderRadius: 2, overflow: "hidden", backgroundColor: surface(theme, 2) }}><View style={{ height: 3, width: `${Math.max(0, Math.min(100, phase.percent ?? 0))}%`, backgroundColor: toneColor(theme, "success") }} /></View>}
  </Pressable>;
}

/** The milestone's phases as chips; the selected one is the one the tab shows. */
export function PhasePicker({ label, phases, selected, onSelect, theme }: ThemeProps & { label: string; phases: readonly PickerPhase[]; selected: string | null; onSelect(id: string): void }) {
  return <View role="list" accessibilityLabel={label} style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
    {phases.map((phase) => <View key={phase.id} role="listitem"><PhaseChip phase={phase} selected={phase.id === selected} onPress={() => onSelect(phase.id)} theme={theme} /></View>)}
  </View>;
}

/** A phase heading for the tabs that read one document per phase: the source file, the phase, and what the file records about itself. */
export function PhaseHeading({ source, id, title, facts, theme }: ThemeProps & { source: string; id: string; title: string; facts: readonly (string | null)[] }) {
  const shown = facts.filter((fact): fact is string => !!fact);
  return <View style={{ gap: 4 }}>
    <Text style={{ ...text(theme, 11, "600", true), letterSpacing: 0.2 }}>{source}</Text>
    <Text role="heading" style={text(theme, 19, "700")}>Phase {id} · {title}</Text>
    {shown.length > 0 && <Text style={{ ...text(theme, 12, "400", true), ...figures }}>{shown.join(" · ")}</Text>}
  </View>;
}
