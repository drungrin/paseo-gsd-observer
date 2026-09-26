import type { BoardReadingState } from "./board-state.js";

/** Host theme colors and the read-only board state shared by every tab. */
export type BoardTheme = { colors: { surface0: string; foreground: string; foregroundMuted: string; accent: string; accentForeground: string; surface1?: string; surface2?: string; border?: string; statusSuccess?: string; statusWarning?: string; statusDanger?: string } };
export type BoardViewState = Pick<BoardReadingState, "workspaceId" | "snapshot" | "busy" | "error"> & Partial<Pick<BoardReadingState, "refreshAnnouncement">>;
