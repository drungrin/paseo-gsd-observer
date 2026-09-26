import type { BoardSnapshot } from "../shared/board-rpc.js";
import type { AllowedInventory, InventoryWarning } from "./allowed-reader.js";
import { buildOverview } from "./overview.js";

const warnings = (values: readonly InventoryWarning[]) => [...new Set(values)].slice(0, 16);

/** Freshness metadata plus the overview projections every tab reads; the workspace is available once its current roadmap was read. */
export function buildBoardSnapshot({ workspaceId, inventory, observedAt }: { workspaceId: string; inventory: AllowedInventory; observedAt: string }): BoardSnapshot {
  if (!inventory.available) return { workspaceId, observedAt: null, freshness: "refresh-failed", availability: "unavailable", revision: 0, warnings: warnings(inventory.warnings), limited: inventory.limited };
  const roadmapRead = inventory.artifacts.some((artifact) => artifact.kind === "roadmap" && artifact.key === "ROADMAP.md");
  return { workspaceId, observedAt, freshness: "current", availability: roadmapRead ? "available" : "unknown", revision: 0, overview: buildOverview(inventory), warnings: warnings(inventory.warnings), limited: inventory.limited };
}
