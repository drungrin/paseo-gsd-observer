type EventName = "change" | "error";
type Listener = (value?: Error | string) => void;

export class FakeWatcher {
  private readonly listeners = new Map<EventName, Set<Listener>>([["change", new Set()], ["error", new Set()]]);
  closed = false;
  on(event: EventName, listener: Listener) { this.listeners.get(event)?.add(listener); return this; }
  emitChange(path: string) { for (const listener of this.listeners.get("change") ?? []) listener(path); }
  emitError(error: Error) { for (const listener of this.listeners.get("error") ?? []) listener(error); }
  listenerCount(event: EventName) { return this.listeners.get(event)?.size ?? 0; }
  async close() { this.closed = true; for (const listeners of this.listeners.values()) listeners.clear(); }
}
