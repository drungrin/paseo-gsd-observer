import type { BoardSnapshot } from "../shared/board-rpc.js";

export type BoardReadingState = { workspaceId: string; snapshot: BoardSnapshot | null; busy: boolean; error: string | null; refreshAnnouncement: string | null };
export const createBoardState = (workspaceId: string): BoardReadingState => ({ workspaceId, snapshot: null, busy: false, error: null, refreshAnnouncement: null });
