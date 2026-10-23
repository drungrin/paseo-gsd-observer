import { useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, Easing, Platform, Pressable, Text, View } from "react-native";
import type { BoardTheme } from "./board-components.js";

/**
 * Surfaces, figures and motion shared by the board. Every color comes from a theme token: tints are a token at a low opacity, the
 * way Paseo tints its own status colors, and motion stops when the system asks for reduced motion.
 */

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger";
type ThemeProps = { theme: BoardTheme };

/** Paseo theme colors are hex strings; "#abc" and "#aabbccdd" are read as "#aabbcc". */
function hex6(color: string): string | null {
  if (/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(color)) return color.slice(0, 7);
  if (/^#[0-9a-f]{3}$/i.test(color)) return `#${[...color.slice(1)].map((digit) => digit + digit).join("")}`;
  return null;
}
const channels = (color: string) => [1, 3, 5].map((index) => parseInt(color.slice(index, index + 2), 16));
const luminance = (color: string) => { const value = hex6(color); if (!value) return 1; const [r, g, b] = channels(value); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
export const isDark = (theme: BoardTheme) => luminance(theme.colors.surface0) < 0.4;

/** A token at a low opacity: 12% on light themes, a third more on dark ones, as Paseo's own status tints. */
export function tint(theme: BoardTheme, color: string, strength = 0.12): string {
  const value = hex6(color);
  if (!value) return color;
  const alpha = Math.max(0, Math.min(1, isDark(theme) ? strength * 1.35 : strength));
  return `${value}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
}

/** A dark accent (Paseo's green) is made for fills; lifted toward white it also reads as text and lines on dark surfaces. */
function lifted(color: string): string {
  const value = hex6(color);
  return value ? `#${channels(value).map((channel) => Math.round(channel + (255 - channel) * 0.42).toString(16).padStart(2, "0")).join("")}` : color;
}

export function toneColor(theme: BoardTheme, tone: Tone): string {
  const { colors } = theme;
  if (tone === "neutral") return colors.foregroundMuted;
  if (tone === "accent") return isDark(theme) && luminance(colors.accent) < 0.45 ? lifted(colors.accent) : colors.accent;
  return (tone === "success" ? colors.statusSuccess : tone === "warning" ? colors.statusWarning : colors.statusDanger) ?? colors.accent;
}
export const surface = (theme: BoardTheme, level: 1 | 2 = 1) => (level === 2 ? theme.colors.surface2 : undefined) ?? theme.colors.surface1 ?? theme.colors.surface0;
export const line = (theme: BoardTheme) => theme.colors.border ?? theme.colors.foregroundMuted;

type Weight = "400" | "500" | "600" | "700";
export const text = (theme: BoardTheme, size = 14, weight: Weight = "400", muted = false) => ({ color: muted ? theme.colors.foregroundMuted : theme.colors.foreground, fontSize: size, lineHeight: Math.round(size * 1.45), fontWeight: weight, flexShrink: 1 });
export const kicker = (theme: BoardTheme) => ({ ...text(theme, 11, "600", true), letterSpacing: 0.8, textTransform: "uppercase" as const });
export const figures = { fontVariant: ["tabular-nums" as const] };
/** Opacity and transform animate on the native thread where there is one; the web has none. */
const nativeDriver = () => Platform.OS !== "web";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (live) setReduced(value); }).catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => { live = false; subscription.remove(); };
  }, []);
  return reduced;
}

/** The current time, every `intervalMs`, for relative times that keep up without a refresh. */
export function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), intervalMs); return () => clearInterval(timer); }, [intervalMs]);
  return now;
}

/** A dot with a breathing ring: something is running right now. */
export function Pulse({ color, size = 8 }: { color: string; size?: number }) {
  const reduced = useReducedMotion();
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(Animated.timing(value, { toValue: 1, duration: 1_800, easing: Easing.out(Easing.quad), useNativeDriver: nativeDriver() }));
    loop.start();
    return () => loop.stop();
  }, [reduced, value]);
  const ring = size * 2.6;
  return <View style={{ width: ring, height: ring, alignItems: "center", justifyContent: "center" }}>
    {!reduced && <Animated.View style={{ position: "absolute", width: ring, height: ring, borderRadius: ring / 2, backgroundColor: color, opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }), transform: [{ scale: value.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }) }] }} />}
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
  </View>;
}

/** Fades and lifts its children in when they first appear. */
export function FadeIn({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const reduced = useReducedMotion();
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) { value.setValue(1); return; }
    Animated.timing(value, { toValue: 1, duration: 380, delay, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver() }).start();
  }, [delay, reduced, value]);
  return <Animated.View style={{ opacity: value, transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }}>{children}</Animated.View>;
}

/** Rings its child once each time `signal` changes to a new value: something that just changed on disk. */
export function Flash({ signal, color, children, radius = 10 }: { signal: number | null; color: string; children: ReactNode; radius?: number }) {
  const reduced = useReducedMotion();
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (signal === null || reduced) return;
    value.setValue(1);
    Animated.timing(value, { toValue: 0, duration: 2_600, easing: Easing.in(Easing.quad), useNativeDriver: nativeDriver() }).start();
  }, [signal, reduced, value]);
  return <View style={{ position: "relative" }}>
    {children}
    <Animated.View pointerEvents="none" style={{ position: "absolute", top: -3, left: -3, right: -3, bottom: -3, borderRadius: radius + 3, borderWidth: 2, borderColor: color, opacity: value }} />
  </View>;
}

export function Pill({ label, tone = "neutral", theme, glyph, strong = false }: ThemeProps & { label: string; tone?: Tone; glyph?: string; strong?: boolean }) {
  const color = toneColor(theme, tone);
  const foreground = tone === "neutral" ? theme.colors.foregroundMuted : color;
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: tone === "neutral" ? surface(theme, 2) : tint(theme, color, strong ? 0.22 : 0.13) }}>
    {glyph && <Text style={{ ...text(theme, 11, "700"), color: foreground }}>{glyph}</Text>}
    <Text style={{ ...text(theme, 12, "500"), color: foreground }}>{label}</Text>
  </View>;
}

/** A borderless raised surface; a tone gives it a soft wash and a rule down its left edge. */
export function Section({ title, overline, aside, children, theme, tone, padding = 20, gap = 14 }: ThemeProps & { title?: string; overline?: string; aside?: ReactNode; children: ReactNode; tone?: Tone; padding?: number; gap?: number }) {
  const color = tone ? toneColor(theme, tone) : null;
  return <View style={{ minWidth: 0, padding, gap, borderRadius: 16, backgroundColor: color ? tint(theme, color, 0.09) : surface(theme), overflow: "hidden" }}>
    {color && <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, backgroundColor: color }} />}
    {(title || overline || aside) && <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <View style={{ gap: 2, flex: 1, minWidth: 0 }}>
        {overline && <Text style={kicker(theme)}>{overline}</Text>}
        {title && <Text role="heading" style={text(theme, 16, "600")}>{title}</Text>}
      </View>
      {aside}
    </View>}
    {children}
  </View>;
}

/** One headline figure with its label above and an optional detail below. */
export function Stat({ label, value, detail, theme, tone, size = 26 }: ThemeProps & { label: string; value: string; detail?: string | null; tone?: Tone; size?: number }) {
  return <View accessible accessibilityLabel={`${label}: ${value}${detail ? `, ${detail}` : ""}`} style={{ flexBasis: 150, flexGrow: 1, minWidth: 0, paddingVertical: 14, paddingHorizontal: 16, gap: 2, borderRadius: 14, backgroundColor: surface(theme) }}>
    <Text style={kicker(theme)}>{label}</Text>
    <Text style={{ ...text(theme, size, "700"), ...figures, color: tone ? toneColor(theme, tone) : theme.colors.foreground }}>{value}</Text>
    {detail ? <Text style={{ ...text(theme, 12, "400", true), ...figures }}>{detail}</Text> : null}
  </View>;
}

export type Segment = { value: number; color: string; label: string };

/** One bar split by value; a tiny segment keeps a sliver so it never disappears. */
export function SegmentBar({ segments, height = 10, theme, label }: ThemeProps & { segments: readonly Segment[]; height?: number; label: string }) {
  const shown = segments.filter((segment) => segment.value > 0);
  return <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ flexDirection: "row", height, gap: shown.length > 1 ? 2 : 0, borderRadius: height / 2, overflow: "hidden", backgroundColor: surface(theme, 2) }}>
    {shown.map((segment) => <View key={segment.label} style={{ flexGrow: segment.value, flexBasis: 0, minWidth: 3, backgroundColor: segment.color }} />)}
  </View>;
}

export function Legend({ items, theme }: ThemeProps & { items: readonly { color: string; label: string }[] }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 4 }}>
    {items.map((item) => <View key={item.label} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: item.color }} />
      <Text style={{ ...text(theme, 12, "400", true), ...figures }}>{item.label}</Text>
    </View>)}
  </View>;
}

/** A label and figure over a bar sized against the largest in its group. */
export function BarRow({ label, detail, value, max, figure, color, theme, onPress }: ThemeProps & { label: string; detail?: string | null; value: number; max: number; figure: string; color: string; onPress?: () => void }) {
  const body = <View style={{ gap: 4 }}>
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
      <Text numberOfLines={1} style={{ ...text(theme, 13, "500"), flex: 1 }}>{label}{detail ? <Text style={text(theme, 12, "400", true)}>{`  ${detail}`}</Text> : null}</Text>
      <Text style={{ ...text(theme, 13, "600"), ...figures }}>{figure}</Text>
    </View>
    <View style={{ height: 6, borderRadius: 3, backgroundColor: surface(theme, 2), overflow: "hidden" }}>
      <View style={{ width: `${max > 0 ? Math.max(1.5, 100 * value / max) : 0}%`, height: "100%", borderRadius: 3, backgroundColor: color }} />
    </View>
  </View>;
  return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${figure}`} onPress={onPress}>{body}</Pressable> : body;
}

/** The notes behind a tab's figures, folded until asked for. */
export function Disclosure({ title, notes, theme }: ThemeProps & { title: string; notes: readonly string[] }) {
  const [open, setOpen] = useState(false);
  if (!notes.length) return null;
  return <View style={{ gap: 8 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={{ alignSelf: "flex-start", minHeight: 32, justifyContent: "center" }}>
      <Text style={text(theme, 12, "600", true)}>{open ? "▾" : "▸"}  {title}</Text>
    </Pressable>
    {open && <View style={{ gap: 6, paddingLeft: 14, borderLeftWidth: 2, borderColor: line(theme) }}>{notes.map((note) => <Text key={note} style={text(theme, 12, "400", true)}>{note}</Text>)}</View>}
  </View>;
}

/** A segmented choice between a few options. */
export function Toggle<V extends string>({ label, options, value, onChange, theme }: ThemeProps & { label: string; options: readonly { value: V; label: string }[]; value: V; onChange(value: V): void }) {
  return <View role="radiogroup" accessibilityLabel={label} style={{ flexDirection: "row", padding: 3, gap: 2, borderRadius: 10, backgroundColor: surface(theme, 2), alignSelf: "flex-start" }}>
    {options.map((option) => {
      const selected = option.value === value;
      return <Pressable key={option.value} accessibilityRole="radio" accessibilityLabel={option.label} accessibilityState={{ selected, checked: selected }} {...(Platform.OS === "web" ? { "aria-checked": selected } : {})} onPress={() => onChange(option.value)} style={{ minHeight: 30, justifyContent: "center", paddingHorizontal: 12, borderRadius: 8, backgroundColor: selected ? theme.colors.surface0 : "transparent" }}>
        <Text style={text(theme, 12, selected ? "600" : "400", !selected)}>{option.label}</Text>
      </Pressable>;
    })}
  </View>;
}

/** "just now", "12m ago", "3h 5m ago", "2d ago"; a bare date reads "today", "yesterday" or "4 days ago" by the local calendar. */
export function ago(value: string | null | undefined, now = Date.now()): string {
  if (!value) return "never";
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (date) {
    const today = new Date(now);
    // Rounded, so a day that a clock change made 23 or 25 hours long still counts as one.
    const days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - new Date(Number(date[1]), Number(date[2]) - 1, Number(date[3])).getTime()) / 86_400_000);
    return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value;
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 45) return "just now";
  if (seconds < 3_600) return `${Math.max(1, Math.round(seconds / 60))}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ${Math.floor((seconds % 3_600) / 60)}m ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

/** A recorded timestamp in UTC, the way the state file writes it: "Oct 22, 02:05 PM UTC". */
export function dateLabel(value: string | null): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });
}

/** "Oct 22" for a recorded date, in UTC so a date never shifts a day. */
export const shortDate = (date: string | null | undefined) => {
  if (!date) return "—";
  const parsed = new Date(`${date.slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : date;
};

/** "Oct 22, 14:05" in local time. */
export const clockTime = (time: string | number | null | undefined) => {
  if (time === null || time === undefined) return "—";
  const parsed = new Date(time);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "—";
};

/** A relative time that keeps itself current. */
export function RelativeTime({ value, theme, prefix = "", style }: ThemeProps & { value: string | null | undefined; prefix?: string; style?: object }) {
  const now = useNow(10_000);
  return <Text style={style ?? text(theme, 12, "400", true)}>{prefix}{ago(value, now)}</Text>;
}

export type TrackStation = { key: string; label: string; detail: string | null; state: "done" | "skipped" | "current" | "future"; tone?: Tone };

/**
 * Stations on a line: done ones filled, the current one ringed (breathing while `moving`), skipped ones dashed, the rest hollow.
 * The line is solid up to the current station. `label` describes the whole track to assistive technology.
 */
export function StationTrack({ stations, label, currentTone = "accent", moving = true, theme, compact }: ThemeProps & { stations: readonly TrackStation[]; label: string; currentTone?: Tone; moving?: boolean; compact: boolean }) {
  const done = toneColor(theme, "success");
  // Not the border token: the track sits on tinted panels, where the border color all but disappears.
  const ahead = tint(theme, theme.colors.foregroundMuted, 0.35);
  const reached = (station: TrackStation) => station.state !== "future";
  const segment = (left: TrackStation | undefined, right: TrackStation | undefined) => left && right && reached(left) && reached(right) ? tint(theme, done, 0.55) : ahead;
  return <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ flexDirection: "row" }}>
    {stations.map((station, index) => {
      const current = station.state === "current";
      const size = current ? 16 : station.state === "skipped" ? 8 : 11;
      const color = station.tone ? toneColor(theme, station.tone) : current ? toneColor(theme, currentTone) : station.state === "done" ? done : "transparent";
      const hollow = station.state === "future" || station.state === "skipped";
      return <View key={station.key} style={{ flex: 1, minWidth: 0, alignItems: "center", gap: 6 }}>
        <View style={{ height: 30, alignSelf: "stretch", flexDirection: "row", alignItems: "center" }}>
          <View style={{ flex: 1, height: 2, backgroundColor: index ? segment(stations[index - 1], station) : "transparent" }} />
          <View style={{ width: 30, height: 30, alignItems: "center", justifyContent: "center" }}>
            {current && moving ? <Pulse color={color} size={size} /> : <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: hollow && !station.tone ? "transparent" : color, borderWidth: hollow ? 2 : 0, borderColor: station.tone && hollow ? color : ahead, borderStyle: station.state === "skipped" ? "dashed" : "solid" }} />}
          </View>
          <View style={{ flex: 1, height: 2, backgroundColor: index < stations.length - 1 ? segment(station, stations[index + 1]) : "transparent" }} />
        </View>
        <Text numberOfLines={1} style={{ ...text(theme, compact ? 11 : 12, current ? "700" : "500", !current && station.state !== "done"), ...(current ? { color: toneColor(theme, currentTone) } : {}) }}>{station.label}</Text>
        <Text numberOfLines={1} style={{ ...text(theme, 11, "400", true), ...figures, marginTop: -6 }}>{station.detail ?? " "}</Text>
      </View>;
    })}
  </View>;
}
