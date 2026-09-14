import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import type { FixtureFile } from "../fixtures/gsd-fixtures";

export class FixtureWorkspace {
  readonly root: string;
  private readonly created: string[] = [];

  private constructor(root: string) { this.root = root; }

  static async create(files: readonly FixtureFile[]) {
    const workspace = new FixtureWorkspace(await mkdtemp(join(tmpdir(), "paseo-gsd-observer-")));
    for (const file of files) await workspace.write(file.path, file.content);
    return workspace;
  }

  private assertContained(path: string) {
    const candidate = resolve(this.root, path);
    const rel = relative(this.root, candidate);
    if (rel === "" || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
      throw new Error(`fixture path escapes workspace: ${path}`);
    }
    return candidate;
  }

  async write(path: string, content: string) {
    const target = this.assertContained(path);
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, content, "utf8");
    this.created.push(target);
    return target;
  }

  async createSymlink(path: string, target: string) {
    const link = this.assertContained(path);
    await mkdir(resolve(link, ".."), { recursive: true });
    await symlink(target, link);
    this.created.push(link);
    return link;
  }

  async cleanup() { await rm(this.root, { recursive: true, force: true }); }
  paths() { return [...this.created]; }
}
