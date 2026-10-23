import { LEDGER_PAGE, type BoardUsage, type LedgerPage, type LedgerRecord } from "../shared/usage.js";

/**
 * Host usage and the turn ledger for one workspace, fetched apart from the board snapshot: reading session logs can take
 * seconds, and the ledger is loaded only when asked for. While the server reports a partial read, usage is fetched again.
 */

export type LedgerState = { loaded: boolean; loading: boolean; error: string | null; complete: boolean; total: number; records: LedgerRecord[] };
export type UsageViewState = { usage: BoardUsage | null; loading: boolean; error: string | null; ledger: LedgerState };
export type UsageController = {
  getState(): UsageViewState;
  subscribe(listener: () => void): () => void;
  load(): Promise<void>;
  loadLedger(more?: boolean): Promise<void>;
  dispose(): void;
};

const emptyLedger = (): LedgerState => ({ loaded: false, loading: false, error: null, complete: true, total: 0, records: [] });
export const createUsageState = (): UsageViewState => ({ usage: null, loading: false, error: null, ledger: emptyLedger() });

export function createUsageController({ workspaceId, callUsageRpc, callLedgerRpc, retryMs = 1_500, maxRetries = 20 }: {
  workspaceId: string;
  callUsageRpc: (input: { workspaceId: string }) => Promise<BoardUsage>;
  callLedgerRpc: (input: { workspaceId: string; offset: number; limit: number; anchor?: number }) => Promise<LedgerPage>;
  retryMs?: number;
  maxRetries?: number;
}): UsageController {
  let state = createUsageState();
  let disposed = false;
  let retries = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let ledgerGeneration = 0;
  const listeners = new Set<() => void>();
  const set = (next: Partial<UsageViewState>) => { if (disposed) return; state = { ...state, ...next }; for (const listener of listeners) listener(); };
  const read = async () => {
    if (disposed || state.loading) return;
    if (retry) { clearTimeout(retry); retry = undefined; }
    set({ loading: true, error: null });
    try {
      const usage = await callUsageRpc({ workspaceId });
      set({ usage, loading: false });
      // A partial read resumes on the server, so asking again shows more until every session file has been read.
      if (!usage.complete && retries < maxRetries && !disposed) { retries += 1; retry = setTimeout(() => { retry = undefined; void read(); }, retryMs); }
    } catch {
      set({ loading: false, error: "Could not read host usage." });
    }
  };
  const controller: UsageController = {
    getState: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    // Every load asked for starts a fresh set of retries.
    async load() { retries = 0; await read(); },
    async loadLedger(more = false) {
      if (disposed || (more && state.ledger.loading)) return;
      const generation = ++ledgerGeneration;
      const records = more ? state.ledger.records : [];
      set({ ledger: { ...state.ledger, records, loading: true, error: null } });
      try {
        const page = await callLedgerRpc({ workspaceId, offset: records.length, limit: LEDGER_PAGE, ...(more ? { anchor: state.ledger.total } : {}) });
        if (generation !== ledgerGeneration) return;
        set({ ledger: { loaded: true, loading: false, error: null, complete: page.complete, total: page.total, records: [...records, ...page.records] } });
      } catch {
        if (generation !== ledgerGeneration) return;
        set({ ledger: { ...state.ledger, loading: false, error: "Could not load the host turn ledger." } });
      }
    },
    dispose() { disposed = true; if (retry) clearTimeout(retry); listeners.clear(); },
  };
  return controller;
}
