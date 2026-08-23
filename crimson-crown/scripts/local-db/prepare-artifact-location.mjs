import { execFileSync } from "node:child_process";
import process from "node:process";

import {
  buildDefaultArtifactRoot,
  prepareArtifactDirectories,
} from "./verify-artifact-location.mjs";

async function main() {
  const workspaceRoot = process.cwd();
  const gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: workspaceRoot,
    encoding: "utf8",
    windowsHide: true,
  }).trim();
  const artifactRoot =
    process.env.CRIMSON_LOCAL_ARTIFACT_ROOT ??
    buildDefaultArtifactRoot(process.env.LOCALAPPDATA);

  const layout = await prepareArtifactDirectories(artifactRoot, {
    gitRoot,
    userProfile: process.env.USERPROFILE,
    workspaceRoot,
  });

  console.log(`Directorio externo seguro preparado: ${layout.root}`);
  console.log("Subdirectorios preparados: raw, sanitized, manifests");
}

main().catch((error) => {
  console.error(
    `No se pudo preparar el directorio externo seguro (${error?.name ?? "Error"}).`,
  );
  process.exitCode = 1;
});
