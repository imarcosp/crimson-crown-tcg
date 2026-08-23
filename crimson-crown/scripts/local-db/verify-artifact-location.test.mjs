import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildDefaultArtifactRoot,
  prepareArtifactDirectories,
  validateArtifactRoot,
} from "./verify-artifact-location.mjs";

const context = {
  gitRoot: "D:\\crimson-crown-tcg",
  userProfile: "C:\\Users\\tester",
  workspaceRoot: "D:\\crimson-crown-tcg\\crimson-crown",
};

test("construye la ubicación predeterminada únicamente desde LOCALAPPDATA", () => {
  assert.equal(
    buildDefaultArtifactRoot("C:\\Users\\tester\\AppData\\Local"),
    "C:\\Users\\tester\\AppData\\Local\\CrimsonCrown\\supabase-mirror",
  );
  assert.throws(
    () => buildDefaultArtifactRoot(""),
    /LOCALAPPDATA no está disponible/i,
  );
});

test("acepta el directorio privado de artefactos fuera del repositorio", () => {
  assert.equal(
    validateArtifactRoot(
      "C:\\Users\\tester\\AppData\\Local\\CrimsonCrown\\supabase-mirror",
      context,
    ),
    "C:\\Users\\tester\\AppData\\Local\\CrimsonCrown\\supabase-mirror",
  );
});

test("rechaza rutas relativas, raíces de unidad y el perfil completo", () => {
  for (const candidate of [
    ".\\artifacts",
    "C:\\",
    "C:\\Users\\tester",
  ]) {
    assert.throws(
      () => validateArtifactRoot(candidate, context),
      /ubicación de artefactos no segura/i,
    );
  }
});

test("rechaza el repositorio, el workspace y cualquiera de sus descendientes", () => {
  for (const candidate of [
    "D:\\crimson-crown-tcg",
    "D:\\crimson-crown-tcg\\backups",
    "D:\\crimson-crown-tcg\\crimson-crown",
    "D:\\crimson-crown-tcg\\crimson-crown\\supabase\\local-artifacts",
  ]) {
    assert.throws(
      () => validateArtifactRoot(candidate, context),
      /ubicación de artefactos no segura/i,
    );
  }
});

test("rechaza cualquier segmento .git sin revelar la ruta en el error", () => {
  const unsafe = "C:\\temp\\.git\\production.sql";

  assert.throws(
    () => validateArtifactRoot(unsafe, context),
    (error) => {
      assert.match(error.message, /ubicación de artefactos no segura/i);
      assert.doesNotMatch(error.message, /production\.sql/i);
      return true;
    },
  );
});

test("crea solamente el layout externo esperado y vuelve a validar su ruta física", async () => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "crimson-artifacts-test-"),
  );
  const candidate = path.join(temporaryRoot, "supabase-mirror");

  try {
    const layout = await prepareArtifactDirectories(candidate, {
      ...context,
      userProfile: process.env.USERPROFILE,
    });

    assert.deepEqual(Object.keys(layout).sort(), [
      "manifests",
      "raw",
      "root",
      "sanitized",
    ]);
    assert.equal(layout.root, path.win32.resolve(candidate));
    assert.equal(layout.raw, path.join(layout.root, "raw"));
    assert.equal(layout.sanitized, path.join(layout.root, "sanitized"));
    assert.equal(layout.manifests, path.join(layout.root, "manifests"));
  } finally {
    const resolvedTemporaryRoot = path.resolve(temporaryRoot);
    assert.ok(resolvedTemporaryRoot.startsWith(path.resolve(os.tmpdir())));
    await rm(resolvedTemporaryRoot, { force: true, recursive: true });
  }
});
