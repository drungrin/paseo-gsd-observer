import { homedir } from "node:os";
import type { BoardSnapshot } from "../shared/board-rpc.js";
import type { AllowedInventory, InventoryWarning } from "./allowed-reader.js";
import { buildOverview } from "./overview.js";
import { buildPath } from "./path-board.js";

const warnings = (values: readonly InventoryWarning[]) => [...new Set(values)].slice(0, 16);

/** This machine's home and workspace root, with and without the leading slash; short roots would match ordinary words. */
function localRoots(root: string | undefined): string[] {
  return [homedir(), root ?? ""].map((value) => value.replace(/\/+$/, "")).flatMap((value) => [value, value.replace(/^\/+/, "")])
    .filter((value) => value.length >= 10 && value.includes("/"));
}

/** Location rules are syntactic, so any token still naming the real home or workspace root is omitted, whichever tab produced it. */
function omitLocalRoots<T>(value: T, roots: readonly string[]): T {
  if (typeof value === "string") return value.replace(/\S+/g, (token) => roots.some((root) => token.includes(root)) ? "[omitted]" : token) as T;
  if (Array.isArray(value)) return value.map((item) => omitLocalRoots(item, roots)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, omitLocalRoots(item, roots)])) as T;
  return value;
}

/**
 * Freshness metadata plus the projections every tab reads. A GSD Core workspace is available once its current roadmap was read;
 * a GSD Path workspace once its state was read or its install shows no milestone has started.
 */
export function buildBoardSnapshot({ workspaceId, inventory, observedAt }: { workspaceId: string; inventory: AllowedInventory; observedAt: string }): BoardSnapshot {
  if (!inventory.available) return { workspaceId, observedAt: null, freshness: "refresh-failed", availability: "unavailable", revision: 0, warnings: warnings(inventory.warnings), limited: inventory.limited };
  if (inventory.flavor === "gsd-path") {
    const path = omitLocalRoots(buildPath(inventory), localRoots(inventory.root));
    const availability = path.setup === "unsupported" ? "unsupported" : path.setup === "not-started" || path.state.availability === "available" ? "available" : "unknown";
    return { workspaceId, observedAt, freshness: "current", availability, revision: 0, flavor: "gsd-path", path, warnings: warnings(path.setup === "unsupported" ? [...inventory.warnings, "unsupported"] : inventory.warnings), limited: inventory.limited };
  }
  const roadmapRead = inventory.artifacts.some((artifact) => artifact.kind === "roadmap" && artifact.key === "ROADMAP.md");
  const overview = omitLocalRoots(buildOverview(inventory), localRoots(inventory.root));
  return { workspaceId, observedAt, freshness: "current", availability: roadmapRead ? "available" : "unknown", revision: 0, flavor: "gsd-core", overview, warnings: warnings(inventory.warnings), limited: inventory.limited };
}
