import type { PluginClientContext } from "@getpaseo/plugin/client";
import { BoardPanel } from "./client/board-panel.js";

export { BoardPanel, createBoardController } from "./client/board-panel.js";
export type { BoardController, BoardTheme, BoardViewState } from "./client/board-panel.js";

export default function contribute(client: PluginClientContext) {
  return client.addWorkspacePanel({ id: "gsd-board", title: "Open GSD Board", icon: "Blocks", context: "workspace", locations: ["workspace", "explorer"], Component: BoardPanel });
}
