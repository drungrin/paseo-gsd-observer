import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { BoardOverviewSchema } from "./overview.js";

const WarningSchema = z.enum([
  "absent", "oversize", "malformed", "truncated", "unsupported",
  "containment-refused", "unreadable", "limit-reached", "observation-limited", "inconsistent",
]);

const AvailabilitySchema = z.enum(["available", "unavailable", "unsupported", "unknown"]);
const FreshnessSchema = z.enum(["current", "stale", "refresh-failed"]);

export const BoardSnapshotSchema = z.object({
  workspaceId: z.string().min(1).max(128),
  observedAt: z.string().datetime().nullable(),
  freshness: FreshnessSchema,
  availability: AvailabilitySchema,
  revision: z.number().int().nonnegative(),
  overview: BoardOverviewSchema.optional(),
  warnings: z.array(WarningSchema).max(16),
  limited: z.boolean(),
}).strict();

export const BoardStatusSchema = z.object({
  kind: z.literal("status"), workspaceId: z.string().min(1).max(128), observedAt: z.string().datetime().nullable(), freshness: FreshnessSchema, availability: AvailabilitySchema, revision: z.number().int().nonnegative(), warnings: z.array(WarningSchema).max(16),
}).strict();

export const BoardResponseSchema = z.union([z.object({ kind: z.literal("snapshot"), snapshot: BoardSnapshotSchema }).strict(), BoardStatusSchema]);
const WorkspaceIdSchema = z.string().min(1).max(128);
export const BoardRequestSchema = z.object({ workspaceId: WorkspaceIdSchema, intent: z.enum(["snapshot", "refresh", "status"]) }).strict();
export const boardRpc = defineRpc({ name: "gsd-observer.board", input: BoardRequestSchema, output: BoardResponseSchema });

export type BoardSnapshot = z.infer<typeof BoardSnapshotSchema>;
export type BoardStatus = z.infer<typeof BoardStatusSchema>;
export type BoardResponse = z.infer<typeof BoardResponseSchema>;
export type BoardRequest = z.infer<typeof BoardRequestSchema>;
