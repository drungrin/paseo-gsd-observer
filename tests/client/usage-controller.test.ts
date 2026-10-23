import { afterEach, describe, expect, it, vi } from "vitest";
import { createUsageController } from "../../client/usage-controller";
import { duration, money, tokens, usageFigures } from "../../client/usage-format";
import type { BoardUsage, LedgerPage } from "../../shared/usage";

const usage = (complete: boolean, turns = 1): BoardUsage => ({ workspaceId: "selected", observedAt: "2026-10-23T00:00:00.000Z", availability: "available", complete, limited: false, pricing: "configured", sessions: 1,
  totals: { turns, prompts: turns, tokensIn: 10, tokensCached: 0, tokensOut: 1, cost: 0.01, pricedTurns: turns, durationS: 3, timedTurns: turns }, models: [], milestones: [], unpriced: [], tasks: [], activity: [], activityLimited: false });
const page = (offset: number, count: number, total: number): LedgerPage => ({ workspaceId: "selected", availability: "available", complete: true, total, offset,
  records: Array.from({ length: count }, (_, index) => ({ at: null, agent: "claude", host: "claude", model: null, tokensIn: offset + index, tokensCached: 0, tokensOut: 0, durationS: null, cost: null })) });

afterEach(() => { vi.useRealTimers(); });

describe("usage controller", () => {
  it("reads usage again after the files change, at most once an interval, and never misses the last change", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const callUsageRpc = vi.fn().mockResolvedValue(usage(true));
    const controller = createUsageController({ workspaceId: "selected", callUsageRpc, callLedgerRpc: vi.fn() });
    await controller.loadIfOlderThan(60_000);
    expect(callUsageRpc).toHaveBeenCalledTimes(1);
    vi.setSystemTime(30_000);
    await controller.loadIfOlderThan(60_000);
    await controller.loadIfOlderThan(60_000);
    expect(callUsageRpc).toHaveBeenCalledTimes(1);
    // The two changes inside the interval are read once, when it ends.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(callUsageRpc).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(callUsageRpc).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it("asks again while the server is still reading session logs, then stops", async () => {
    vi.useFakeTimers();
    const callUsageRpc = vi.fn().mockResolvedValueOnce(usage(false, 1)).mockResolvedValueOnce(usage(false, 2)).mockResolvedValue(usage(true, 3));
    const controller = createUsageController({ workspaceId: "selected", callUsageRpc, callLedgerRpc: vi.fn(), retryMs: 100 });
    await controller.load();
    expect(controller.getState().usage?.totals.turns).toBe(1);
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);
    expect(controller.getState().usage).toMatchObject({ complete: true, totals: { turns: 3 } });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(callUsageRpc).toHaveBeenCalledTimes(3);
    controller.dispose();
  });

  it("gives every load asked for a fresh set of retries", async () => {
    vi.useFakeTimers();
    const callUsageRpc = vi.fn().mockResolvedValue(usage(false));
    const controller = createUsageController({ workspaceId: "selected", callUsageRpc, callLedgerRpc: vi.fn(), retryMs: 10, maxRetries: 2 });
    await controller.load();
    await vi.advanceTimersByTimeAsync(100);
    expect(callUsageRpc).toHaveBeenCalledTimes(3);
    await controller.load();
    await vi.advanceTimersByTimeAsync(100);
    expect(callUsageRpc).toHaveBeenCalledTimes(6);
    controller.dispose();
  });

  it("keeps the last figures when a later read fails, and stops retrying once disposed", async () => {
    vi.useFakeTimers();
    const callUsageRpc = vi.fn().mockResolvedValueOnce(usage(false)).mockRejectedValue(new Error("down"));
    const controller = createUsageController({ workspaceId: "selected", callUsageRpc, callLedgerRpc: vi.fn(), retryMs: 100 });
    await controller.load();
    await vi.advanceTimersByTimeAsync(100);
    expect(controller.getState()).toMatchObject({ error: "Could not read host usage.", usage: { totals: { turns: 1 } } });
    controller.dispose();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(callUsageRpc).toHaveBeenCalledTimes(2);
  });

  it("loads the ledger in pages on demand and restarts it on reload", async () => {
    const callLedgerRpc = vi.fn(async ({ offset, limit }: { offset: number; limit: number }) => page(offset, Math.min(limit, 450 - offset), 450));
    const controller = createUsageController({ workspaceId: "selected", callUsageRpc: vi.fn(), callLedgerRpc });
    expect(controller.getState().ledger.loaded).toBe(false);
    await controller.loadLedger();
    await controller.loadLedger(true);
    expect(controller.getState().ledger).toMatchObject({ loaded: true, total: 450 });
    expect(controller.getState().ledger.records).toHaveLength(400);
    // Later pages page through the turns the first page counted, so a busy session never repeats a row.
    expect(callLedgerRpc.mock.calls.map(([input]) => input)).toEqual([{ workspaceId: "selected", offset: 0, limit: 200 }, { workspaceId: "selected", offset: 200, limit: 200, anchor: 450 }]);
    await controller.loadLedger();
    expect(controller.getState().ledger.records).toHaveLength(200);
  });
});

describe("usage figures", () => {
  it("formats figures as the daemon's dashboard does", () => {
    expect([tokens(999), tokens(1_499), tokens(12_345_678), tokens(1_234_567_890)]).toEqual(["999", "1k", "12.3M", "1.23B"]);
    expect([money(null), money(0.084), money(2345.67)]).toEqual(["—", "$0.08", "$2,345.67"]);
    expect([duration(59), duration(20_000), duration(150_000)]).toEqual(["0m", "5h 33m", "1d 17h"]);
    expect(usageFigures({ turns: 0, prompts: 0, tokensIn: 0, tokensCached: 0, tokensOut: 0, cost: null, pricedTurns: 0, durationS: 0, timedTurns: 0 }).map(([, value]) => value))
      .toEqual(["—", "0", "0", "0", "0", "0", "—", "—", "—", "—"]);
  });
});
