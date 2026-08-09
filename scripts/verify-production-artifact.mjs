import { access, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

export async function verifyProductionArtifact(
  artifactRoot = process.argv[2],
  manifestPath = path.resolve("package.json"),
) {
  if (!artifactRoot) throw new Error("PRODUCTION_ARTIFACT_ROOT_REQUIRED");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const developmentDependencies = Object.keys(manifest.devDependencies ?? {});
  if (developmentDependencies.length === 0) throw new Error("DEV_DEPENDENCY_LIST_EMPTY");
  const nodeModules = path.resolve(artifactRoot, "node_modules");
  if (!(await exists(nodeModules))) throw new Error("PRODUCTION_NODE_MODULES_MISSING");

  const leaked = [];
  const pnpmStore = path.join(nodeModules, ".pnpm");
  const pnpmEntries = await readdir(pnpmStore).catch(() => []);
  for (const dependency of developmentDependencies) {
    const encoded = dependency.replace("/", "+");
    if (
      await exists(path.join(nodeModules, ...dependency.split("/"))) ||
      pnpmEntries.some((entry) => entry.startsWith(`${encoded}@`))
    ) leaked.push(dependency);
  }
  if (leaked.length > 0) throw new Error(`DEV_DEPENDENCIES_PRESENT:${leaked.join(",")}`);
  return { checked: developmentDependencies.length };
}

export async function pruneProductionArtifact(
  artifactRoot,
  manifestPath = path.resolve("package.json"),
) {
  if (!artifactRoot) throw new Error("PRODUCTION_ARTIFACT_ROOT_REQUIRED");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const developmentDependencies = Object.keys(manifest.devDependencies ?? {});
  if (developmentDependencies.length === 0) throw new Error("DEV_DEPENDENCY_LIST_EMPTY");
  const nodeModules = path.resolve(artifactRoot, "node_modules");
  const pnpmStore = path.join(nodeModules, ".pnpm");
  const pnpmEntries = await readdir(pnpmStore).catch(() => []);
  for (const dependency of developmentDependencies) {
    await rm(path.join(nodeModules, ...dependency.split("/")), { force: true, recursive: true });
    const encoded = dependency.replace("/", "+");
    for (const entry of pnpmEntries) {
      if (entry.startsWith(`${encoded}@`)) {
        await rm(path.join(pnpmStore, entry), { force: true, recursive: true });
      }
    }
  }
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const prune = process.argv.includes("--prune");
  const artifactRoot = process.argv.slice(2).find((argument) => argument !== "--prune");
  Promise.resolve()
    .then(() => prune ? pruneProductionArtifact(artifactRoot) : undefined)
    .then(() => verifyProductionArtifact(artifactRoot))
    .then(({ checked }) => process.stdout.write(`Production artifact excludes ${checked} root devDependencies.\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : "PRODUCTION_ARTIFACT_INVALID"}\n`);
      process.exitCode = 1;
    });
}
