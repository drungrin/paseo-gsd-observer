/**
 * React Native and React stand-ins for rendering components as plain function calls: elements keep their props, hooks return
 * their initial values, effects never run and animations stay still.
 */

class AnimatedValue {
  constructor(public value = 0) {}
  setValue(value: number) { this.value = value; }
  interpolate() { return this; }
}
const still = () => ({ start() {}, stop() {} });

export const reactNativeMock = {
  View: "View", Text: "Text", Pressable: "Pressable", ScrollView: "ScrollView", FlatList: "FlatList", Platform: { OS: "web" },
  Animated: { View: "AnimatedView", Value: AnimatedValue, timing: still, loop: still },
  Easing: { in: () => () => 0, out: () => () => 0, quad: () => 0, cubic: () => 0 },
  AccessibilityInfo: { isReduceMotionEnabled: async () => false, addEventListener: () => ({ remove() {} }) },
};

export const reactHooksMock = <T extends object>(original: T) => ({
  ...original,
  useState: (value: unknown) => [typeof value === "function" ? (value as () => unknown)() : value, () => undefined],
  useEffect: () => undefined,
  useRef: (value: unknown) => ({ current: value }),
  useMemo: (factory: () => unknown) => factory(),
  useCallback: (callback: unknown) => callback,
});

type Element = { type?: unknown; props?: Record<string, unknown> };
/** Calls every function component, through `memo`, down to host elements; the tree tests read text and props from. */
export const expand = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(expand);
  if (!node || typeof node !== "object") return node;
  const value = node as Element;
  const inner = value.type && typeof value.type === "object" && "type" in value.type ? (value.type as { type: unknown }).type : value.type;
  if (typeof inner === "function") return expand((inner as (props: Record<string, unknown>) => unknown)(value.props ?? {}));
  return { ...value, props: { ...value.props, children: expand(value.props?.children) } };
};
