import type { PluginRpcContract } from "@getpaseo/plugin";
import type { ZodType } from "zod";

export type RegisteredPanel = { id: string; workspaceOnly: boolean };
export type ElementNode = { type: string; props?: Record<string, unknown>; children?: ElementNode[] };

export class FakeHost {
  readonly panels: RegisteredPanel[] = [];
  private readonly workspaces = new Map<string, string>();
  private readonly handlers = new Map<string, (input: unknown, context: { paseo: { workspaceId: string } }) => unknown | Promise<unknown>>();

  registerWorkspace(id: string, directory: string) { this.workspaces.set(id, directory); }
  resolveWorkspace(id: string) {
    const directory = this.workspaces.get(id);
    if (!directory) throw new Error("unknown workspace");
    return directory;
  }
  addWorkspacePanel(panel: { id: string }) { this.panels.push({ id: panel.id, workspaceOnly: true }); }
  handle<Input extends ZodType, Output extends ZodType>(contract: PluginRpcContract<Input, Output>, handler: (input: unknown, context: { paseo: { workspaceId: string } }) => unknown | Promise<unknown>) {
    this.handlers.set(contract.name, async (input, context) => contract.output.parseAsync(await handler(await contract.input.parseAsync(input), context)));
  }
  async invoke<Input extends ZodType, Output extends ZodType>(contract: PluginRpcContract<Input, Output>, input: unknown, workspaceId: string) {
    const handler = this.handlers.get(contract.name);
    if (!handler) throw new Error("unregistered RPC");
    return contract.output.parseAsync(await handler(await contract.input.parseAsync(input), { paseo: { workspaceId } }));
  }
}

export const press = (node: ElementNode) => {
  const onPress = node.props?.onPress;
  if (typeof onPress !== "function") throw new Error("element has no press handler");
  return (onPress as () => unknown)();
};
