import path from "node:path";
import { mkdir, realpath } from "node:fs/promises";

const WINDOWS_PATH = path.win32;
const UNSAFE_LOCATION_MESSAGE =
  "Ubicación de artefactos no segura; usa el directorio privado configurado fuera del repositorio.";

export class UnsafeArtifactLocationError extends Error {
  constructor() {
    super(UNSAFE_LOCATION_MESSAGE);
    this.name = "UnsafeArtifactLocationError";
  }
}

function rejectUnsafeLocation() {
  throw new UnsafeArtifactLocationError();
}

function isSameOrDescendant(candidate, protectedRoot) {
  const relative = WINDOWS_PATH.relative(protectedRoot, candidate);

  return (
    relative === "" ||
    (!relative.startsWith(`..${WINDOWS_PATH.sep}`) &&
      relative !== ".." &&
      !WINDOWS_PATH.isAbsolute(relative))
  );
}

export function buildDefaultArtifactRoot(localAppData) {
  if (typeof localAppData !== "string" || localAppData.trim() === "") {
    throw new Error(
      "LOCALAPPDATA no está disponible; no se puede elegir una ubicación externa segura.",
    );
  }

  return WINDOWS_PATH.join(
    localAppData,
    "CrimsonCrown",
    "supabase-mirror",
  );
}

export function validateArtifactRoot(
  candidate,
  { gitRoot, userProfile, workspaceRoot },
) {
  if (typeof candidate !== "string" || !WINDOWS_PATH.isAbsolute(candidate)) {
    rejectUnsafeLocation();
  }

  const resolved = WINDOWS_PATH.resolve(candidate);
  const driveRoot = WINDOWS_PATH.parse(resolved).root;

  if (resolved.toLowerCase() === driveRoot.toLowerCase()) {
    rejectUnsafeLocation();
  }

  const segments = resolved.split(/[\\/]+/u);
  if (segments.some((segment) => segment.toLowerCase() === ".git")) {
    rejectUnsafeLocation();
  }

  if (
    typeof userProfile === "string" &&
    WINDOWS_PATH.resolve(userProfile).toLowerCase() === resolved.toLowerCase()
  ) {
    rejectUnsafeLocation();
  }

  for (const protectedRoot of [gitRoot, workspaceRoot]) {
    if (
      typeof protectedRoot === "string" &&
      WINDOWS_PATH.isAbsolute(protectedRoot) &&
      isSameOrDescendant(resolved, WINDOWS_PATH.resolve(protectedRoot))
    ) {
      rejectUnsafeLocation();
    }
  }

  return resolved;
}

export async function prepareArtifactDirectories(candidate, context) {
  const root = validateArtifactRoot(candidate, context);

  await mkdir(root, { recursive: true });

  const physicalRoot = await realpath(root);
  validateArtifactRoot(physicalRoot, context);

  const layout = {
    root,
    raw: path.join(root, "raw"),
    sanitized: path.join(root, "sanitized"),
    manifests: path.join(root, "manifests"),
  };

  await Promise.all(
    Object.values(layout)
      .filter((directory) => directory !== root)
      .map((directory) => mkdir(directory, { recursive: true })),
  );

  return layout;
}
