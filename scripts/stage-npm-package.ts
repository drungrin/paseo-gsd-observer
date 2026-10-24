import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

type JsonObject = Record<string, unknown>;

const readJson = async (path: string) => JSON.parse(await readFile(path, "utf8")) as JsonObject;
const writeJson = (path: string, value: JsonObject) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);

/**
 * Stages the npm artifact of this plugin. The repository keeps `private: true` so nothing is published by
 * accident, and its manifest declares a Git-only `npm ci` preparation step. An npm install already installs the
 * production dependencies, so the staged package drops both and ships the lock as a shrinkwrap.
 */
export async function stageNpmPackage(sourceDirectory: string, destinationDirectory: string): Promise<void> {
  const source = resolve(sourceDirectory);
  const destination = resolve(destinationDirectory);
  const fromSource = relative(source, destination);
  const outsideSource = isAbsolute(fromSource) || fromSource === ".." || fromSource.startsWith(`..${sep}`);
  if (!outsideSource) {
    throw new Error("The staged package must be outside the plugin source");
  }

  const packageJson = await readJson(join(source, "package.json"));
  const manifest = await readJson(join(source, "paseo-plugin.json"));
  const files = packageJson.files;
  if (!Array.isArray(files) || files.some((file) => typeof file !== "string")) {
    throw new Error("package.json must list the published files");
  }

  await mkdir(destination, { recursive: true });
  if ((await readdir(destination)).length > 0) throw new Error(`Staging directory is not empty: ${destination}`);

  const staged = [...new Set<string>([...(files as string[]), "README.md", "LICENSE"])];
  await Promise.all(staged.map((path) => cp(join(source, path), join(destination, path), { recursive: true })));

  delete packageJson.private;
  delete manifest.build;
  await writeJson(join(destination, "package.json"), packageJson);
  await writeJson(join(destination, "paseo-plugin.json"), manifest);
  await cp(join(source, "package-lock.json"), join(destination, "npm-shrinkwrap.json"));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const destination = process.argv[2];
  if (!destination) throw new Error("Usage: node scripts/stage-npm-package.ts <empty directory outside the repository>");
  await stageNpmPackage(process.cwd(), destination);
  console.log(`Staged ${destination}. Publish it with: npm publish ${destination}`);
}
