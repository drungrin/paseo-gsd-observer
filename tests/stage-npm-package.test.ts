import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { stageNpmPackage } from "../scripts/stage-npm-package";

const repository = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (path: string) => JSON.parse(await readFile(path, "utf8")) as Record<string, any>;

/** Libraries Paseo provides to every plugin, so they are not installed from this package. */
const HOST_MODULES = new Set(["@getpaseo/plugin", "react", "react-native"]);

const packageName = (specifier: string) => specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/");

const runtimeImports = async () => {
  const names = new Set<string>();
  for (const entry of ["index.client.tsx", "index.server.ts", "client", "server", "shared"]) {
    const paths = entry.includes(".") ? [entry] : (await readdir(join(repository, entry), { recursive: true })).filter((path) => /\.tsx?$/.test(path)).map((path) => join(entry, path));
    for (const path of paths) {
      for (const [, specifier] of (await readFile(join(repository, path), "utf8")).matchAll(/(?:from|import\()\s*"([^."][^"]*)"/g)) {
        if (!specifier.startsWith("node:")) names.add(packageName(specifier));
      }
    }
  }
  return names;
};

describe("npm package", () => {
  const directories: string[] = [];
  const emptyDirectory = async () => {
    const directory = await mkdtemp(join(tmpdir(), "observer-stage-"));
    directories.push(directory);
    return directory;
  };
  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("declares every library its runtime code imports, apart from the ones Paseo provides", async () => {
    const { dependencies } = await readJson(join(repository, "package.json"));
    const undeclared = [...(await runtimeImports())].filter((name) => !HOST_MODULES.has(name) && !(name in dependencies));
    expect(undeclared).toEqual([]);
  });

  it("keeps the repository private and its Git preparation step, which the staged package drops", async () => {
    const packageJson = await readJson(join(repository, "package.json"));
    const manifest = await readJson(join(repository, "paseo-plugin.json"));
    expect(packageJson.private).toBe(true);
    expect(manifest.build).toEqual([["npm", "ci", "--omit=dev", "--ignore-scripts"]]);

    const staged = join(await emptyDirectory(), "package");
    await stageNpmPackage(repository, staged);
    const stagedPackage = await readJson(join(staged, "package.json"));
    const stagedManifest = await readJson(join(staged, "paseo-plugin.json"));
    expect(stagedPackage.private).toBeUndefined();
    expect(stagedPackage.name).toBe(packageJson.name);
    expect(stagedPackage.publishConfig).toEqual({ access: "public" });
    expect(stagedManifest.build).toBeUndefined();
    expect(stagedManifest.id).toBe(manifest.id);
    expect(await readFile(join(staged, "npm-shrinkwrap.json"), "utf8")).toBe(await readFile(join(repository, "package-lock.json"), "utf8"));
  });

  it("stages only the plugin source, never tests, docs or local state", async () => {
    const staged = join(await emptyDirectory(), "package");
    await stageNpmPackage(repository, staged);
    const top = (await readdir(staged)).sort();
    expect(top).toEqual(["LICENSE", "README.md", "client", "index.client.tsx", "index.server.ts", "npm-shrinkwrap.json", "package.json", "paseo-plugin.json", "server", "shared"]);
    expect((await readdir(staged, { recursive: true })).filter((path) => /\.test\./.test(path))).toEqual([]);
  });

  it("refuses a staging directory that is not empty or sits inside the source", async () => {
    const occupied = await emptyDirectory();
    await writeFile(join(occupied, "keep.txt"), "kept");
    await expect(stageNpmPackage(repository, occupied)).rejects.toThrow("not empty");
    expect(await readFile(join(occupied, "keep.txt"), "utf8")).toBe("kept");

    await expect(stageNpmPackage(repository, join(repository, "client"))).rejects.toThrow("outside the plugin source");
    await expect(stageNpmPackage(repository, repository)).rejects.toThrow("outside the plugin source");
  });
});
