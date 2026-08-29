# Crimson Crown P0 Environment and Release Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Crimson runtime fail closed on a foreign Supabase target and generate a reproducible release projection that never reapplies historical migrations.

**Architecture:** One pure environment policy classifies loopback, Crimson production and the explicitly configured Crimson staging ref. The same policy protects build, proxy, server and browser client creation. A versioned manifest classifies migration files; a temporary projection makes the Supabase CLI see the real remote versions while excluding verified baseline SQL.

**Tech Stack:** Next.js 16, TypeScript, Node 24/`node:test`, PowerShell, Supabase CLI 2.113.0, SHA-256.

**Spec:** `docs/superpowers/specs/2026-08-29-crimson-crown-emergency-hardening-design.md`

## Global Constraints

- Work only in Crimson Crown on `codex/crimson-remaining-backlog`.
- Never use refs `jzkxvgntwompkntimrao`, `tszglqwrklthnzhqdffn` or `shwqihiueeuqeumdoepn`.
- Production ref is exactly `djfqozfaqkqdoqeoqbzt`; local Supabase is loopback port `54621`.
- Preview/Development remote remain blocked until a dedicated Crimson staging ref is configured.
- Node runtime is 24.19.0 locally and must be at least 22 because current Supabase client releases no longer support Node 20.
- Do not run `migration repair`, a non-dry-run `db push`, deploys or production writes.
- Do not print URLs containing credentials, keys or environment values in errors.

---

## File map

- Create `src/lib/environment/supabase-target-policy.mjs`: pure shared target classifier and fail-closed assertions.
- Create `src/lib/environment/supabase-target-policy.d.ts`: explicit TypeScript declarations for the shared JavaScript module.
- Modify `src/lib/environment/production-guards.ts`: reuse the shared policy and retain test-environment checks.
- Modify `src/lib/environment/production-guards.test.ts`: table-driven target/secret-leak tests.
- Modify `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`, `src/proxy.ts`: validate before constructing clients.
- Modify `next.config.mjs`: run the build-time assertion.
- Create `scripts/assert-deployment-environment.mjs` and `scripts/assert-deployment-environment.test.mjs`: CLI gate and contract tests.
- Create `scripts/release/migration-manifest.json`: classification and hashes for every migration.
- Create `scripts/release/bootstrap-migration-manifest.mjs`: one-time deterministic manifest generator that refuses overwrite.
- Create `scripts/release/migration-manifest.mjs`: manifest parser/validator.
- Create `scripts/release/migration-manifest.test.mjs`: completeness, hash and drift tests.
- Create `scripts/release/build-supabase-projection.mjs`: deterministic temporary `supabase/` projection.
- Create `scripts/release/build-supabase-projection.test.mjs`: fixture-based projection tests.
- Create `scripts/release/run-linked-dry-run.ps1`: exact-project, dry-run-only wrapper with cleanup.
- Create `scripts/release/run-linked-dry-run.test.mjs`: static safety contract for the wrapper.
- Modify `package.json`: expose focused safety and release-manifest test commands; require Node 22+.
- Modify `.gitignore`: ignore `local-artifacts/release-evidence/` explicitly while retaining the broader artifact ban.
- Create `docs/runbooks/crimson-release-projection.md`: operator procedure and invalid-output rules.

### Task 1: Shared fail-closed Supabase target policy

**Files:**
- Create: `src/lib/environment/supabase-target-policy.mjs`
- Create: `src/lib/environment/supabase-target-policy.d.ts`
- Modify: `src/lib/environment/production-guards.ts`
- Modify: `src/lib/environment/production-guards.test.ts`

**Interfaces:**
- Produces: `classifySupabaseTarget(rawUrl, stagingRef) -> { kind, projectRef, url }`.
- Produces: `assertSafeRuntimeSupabaseUrl(rawUrl, env) -> URL`.
- Produces: `assertSafeClientSupabaseUrl(rawUrl, expectedTarget, stagingRef) -> URL`.

- [ ] **Step 1: Write failing table-driven policy tests**

Add cases proving exact outcomes and non-disclosure:

```ts
const foreignRefs = [
  'jzkxvgntwompkntimrao',
  'tszglqwrklthnzhqdffn',
  'shwqihiueeuqeumdoepn',
]

for (const projectRef of foreignRefs) {
  assert.throws(
    () => assertSafeRuntimeSupabaseUrl(`https://${projectRef}.supabase.co`, {
      VERCEL_ENV: 'preview',
      CRIMSON_STAGING_SUPABASE_PROJECT_REF: projectRef,
    }),
    (error: unknown) => error instanceof UnsafeEnvironmentError &&
      !error.message.includes(projectRef),
  )
}

assert.throws(() => assertSafeRuntimeSupabaseUrl(
  'https://arbitraryref1234567890.supabase.co',
  { VERCEL_ENV: 'production' },
))
assert.doesNotThrow(() => assertSafeRuntimeSupabaseUrl(
  'https://djfqozfaqkqdoqeoqbzt.supabase.co',
  { VERCEL_ENV: 'production' },
))
assert.doesNotThrow(() => assertSafeRuntimeSupabaseUrl(
  'https://crimsonstage12345678.supabase.co',
  {
    VERCEL_ENV: 'preview',
    CRIMSON_STAGING_SUPABASE_PROJECT_REF: 'crimsonstage12345678',
  },
))
assert.throws(() => assertSafeRuntimeSupabaseUrl(
  'http://127.0.0.1:54621',
  { VERCEL_ENV: 'preview' },
))
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --experimental-strip-types src/lib/environment/production-guards.test.ts
```

Expected: FAIL because foreign refs, staging allowlist and strict production matching are not implemented.

- [ ] **Step 3: Implement the pure policy**

Use these exact public contracts in `supabase-target-policy.mjs`:

```js
export const CRIMSON_PRODUCTION_PROJECT_REF = 'djfqozfaqkqdoqeoqbzt'
export const CRIMSON_LOCAL_SUPABASE_API_PORT = '54621'
export const FORBIDDEN_PROJECT_REFS = Object.freeze([
  'jzkxvgntwompkntimrao',
  'tszglqwrklthnzhqdffn',
  'shwqihiueeuqeumdoepn',
])

export function classifySupabaseTarget(rawUrl, stagingRef = '') {
  const url = parseWithoutEcho(rawUrl)
  if (isLoopback(url) && url.protocol === 'http:' && url.port === CRIMSON_LOCAL_SUPABASE_API_PORT) {
    return { kind: 'local', projectRef: null, url }
  }
  const projectRef = extractHostedProjectRef(url)
  if (!projectRef || FORBIDDEN_PROJECT_REFS.includes(projectRef)) throw unsafeTarget()
  if (projectRef === CRIMSON_PRODUCTION_PROJECT_REF) return { kind: 'production', projectRef, url }
  if (stagingRef && projectRef === stagingRef && !FORBIDDEN_PROJECT_REFS.includes(stagingRef)) {
    return { kind: 'staging', projectRef, url }
  }
  throw unsafeTarget()
}
```

`parseWithoutEcho`, `unsafeTarget`, `isLoopback` and `extractHostedProjectRef` stay private. `extractHostedProjectRef` accepts only `https://<ref>.supabase.co` and `https://<ref>.supabase.in`; it rejects credentials, paths that alter origin identity and substring matches.

`assertSafeRuntimeSupabaseUrl` maps environments exactly:

```js
const expected = env.VERCEL_ENV === 'production'
  ? 'production'
  : env.VERCEL_ENV === 'preview' || env.VERCEL_ENV === 'development'
    ? 'staging'
    : 'local'
```

If actual and expected differ, throw `UnsafeEnvironmentError('Entorno Supabase no autorizado para este deployment.')`.

- [ ] **Step 4: Add exact `.d.ts` declarations and TypeScript wrapper**

Declare `SupabaseTargetKind = 'local' | 'staging' | 'production'` and type every exported function without `any`. Keep `assertSafeTestEnvironment` in `production-guards.ts`, but call the new classifier for Supabase.

- [ ] **Step 5: Run focused and existing safety tests**

Run `npm run test:environment-safety`.

Expected: all existing tests plus the new target table PASS; no test performs network I/O.

- [ ] **Step 6: Commit the policy**

```bash
git add src/lib/environment/supabase-target-policy.mjs src/lib/environment/supabase-target-policy.d.ts src/lib/environment/production-guards.ts src/lib/environment/production-guards.test.ts
git commit -m "security: enforce crimson supabase targets"
```

### Task 2: Enforce the policy at build and client creation

**Files:**
- Modify: `src/lib/supabase/client.ts`
- Modify: `src/lib/supabase/server.ts`
- Modify: `src/proxy.ts`
- Modify: `next.config.mjs`
- Create: `scripts/assert-deployment-environment.mjs`
- Create: `scripts/assert-deployment-environment.test.mjs`
- Modify: `scripts/assert-vercel-environment-safety.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 1 assertions.
- Produces: CLI exit code 0 only for a valid target/environment pair.

- [ ] **Step 1: Write failing build/client contract tests**

The test spawns the gate with synthetic environments and asserts only class-level errors:

```js
const result = spawnSync(process.execPath, ['scripts/assert-deployment-environment.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    VERCEL_ENV: 'preview',
    NEXT_PUBLIC_SUPABASE_URL: 'https://jzkxvgntwompkntimrao.supabase.co',
    CRIMSON_STAGING_SUPABASE_PROJECT_REF: 'jzkxvgntwompkntimrao',
  },
  encoding: 'utf8',
})
assert.notEqual(result.status, 0)
assert.doesNotMatch(`${result.stdout}${result.stderr}`, /jzkxvgntwompkntimrao/)
```

Also assert source order: every `createBrowserClient`/`createServerClient` call is preceded by an assertion in its factory.

- [ ] **Step 2: Run tests and confirm RED**

Run:

```powershell
node --test scripts/assert-deployment-environment.test.mjs scripts/assert-vercel-environment-safety.test.mjs
```

Expected: FAIL because the gate file and strict integrations do not exist.

- [ ] **Step 3: Implement the deployment gate**

Fuera de Vercel, `assert-deployment-environment.mjs` carga únicamente `.env.local` mediante `dotenv.config({ path: '.env.local', override: false })`; nunca carga `.env.staging`. Después llama la política compartida:

```js
assertSafeRuntimeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', process.env)
if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()) {
  throw new UnsafeEnvironmentError('Entorno Supabase incompleto para este deployment.')
}
```

En Preview/Development exige que `CRIMSON_STAGING_SUPABASE_PROJECT_REF` y `NEXT_PUBLIC_CRIMSON_STAGING_SUPABASE_PROJECT_REF` existan, sean iguales y no pertenezcan a la denylist. El ref público no es una clave; permite que el navegador verifique la misma identidad que build/proxy.

It catches `UnsafeEnvironmentError`, writes only `error.name` plus a stable message, and sets `process.exitCode = 1`.

- [ ] **Step 4: Protect all constructors and build**

- `client.ts` calls `assertSafeClientSupabaseUrl` before `createBrowserClient`, defaults expected target to `local`, and receives staging ref from `NEXT_PUBLIC_CRIMSON_STAGING_SUPABASE_PROJECT_REF`.
- `server.ts` calls `assertSafeRuntimeSupabaseUrl` unconditionally before `createServerClient`.
- `proxy.ts` retains its 503 behavior but uses the strict assertion.
- `next.config.mjs` imports and invokes the deployment gate function before exporting config.
- `package.json` changes `build` to `node scripts/assert-deployment-environment.mjs && next build`, adds `engines.node: ">=22"`, and adds `test:deployment-safety`.

For Vercel, `NEXT_PUBLIC_CRIMSON_DEPLOYMENT_TARGET` is `production` in Production and `staging` in Preview/Development. Local defaults to `local`.

- [ ] **Step 5: Verify valid and invalid builds without network**

Run the gate for loopback, synthetic staging and exact production environments. Then run `npm run test:environment-safety` and `npm run typecheck`.

Expected: valid triples exit 0; foreign/arbitrary/mismatched triples exit non-zero without echoing values; TypeScript PASS.

- [ ] **Step 6: Commit integrations**

```bash
git add next.config.mjs package.json src/lib/supabase/client.ts src/lib/supabase/server.ts src/proxy.ts scripts/assert-deployment-environment.mjs scripts/assert-deployment-environment.test.mjs scripts/assert-vercel-environment-safety.test.mjs
git commit -m "security: gate every supabase client and build"
```

### Task 3: Versioned migration manifest

**Files:**
- Create: `scripts/release/migration-manifest.json`
- Create: `scripts/release/bootstrap-migration-manifest.mjs`
- Create: `scripts/release/migration-manifest.mjs`
- Create: `scripts/release/migration-manifest.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `loadAndValidateManifest({ rootDir, allowCandidates })`.
- Produces: classifications `remote_applied`, `baseline_present`, `forward_pending`.

- [ ] **Step 1: Write failing completeness/hash tests**

Use a temporary fixture and the real tree:

```js
test('every migration is classified exactly once and hashes match', async () => {
  const manifest = await loadAndValidateManifest({ rootDir: process.cwd(), allowCandidates: true })
  const classified = manifest.entries.map((entry) => entry.file).sort()
  const actual = (await readdir('supabase/migrations')).filter((name) => name.endsWith('.sql')).sort()
  assert.deepEqual(classified, actual)
})

test('projection is blocked while a remote pair is only a candidate', async () => {
  await assert.rejects(
    () => loadAndValidateManifest({ rootDir: process.cwd(), allowCandidates: false }),
    /equivalencia remota sin verificar/,
  )
})
```

Add negative fixtures for duplicate version, unknown file, changed hash, foreign project ref and two classes assigned to one file.

- [ ] **Step 2: Run and confirm RED**

Run `node --test scripts/release/migration-manifest.test.mjs`.

Expected: FAIL because parser and manifest do not exist.

- [ ] **Step 3: Implement strict parser and deterministic bootstrap**

The manifest has this exact shape:

```json
{
  "schemaVersion": 1,
  "productionProjectRef": "djfqozfaqkqdoqeoqbzt",
  "entries": [
    {
      "class": "remote_applied",
      "version": "20260826210617",
      "remoteName": "production_runtime_functions",
      "file": "20260826120000_production_runtime_functions.sql",
      "sha256": "1495f5ccbd382224fa5c28312ecc488f29ad8bd680020dda73e9f68a183388f3",
      "equivalence": "candidate"
    },
    {
      "class": "forward_pending",
      "version": "20260829021742",
      "file": "20260829021742_admin_product_mutations.sql",
      "sha256": "52d24ebf8abe6727df7da45ca723d8226f7aa433e3ef527aef7b598376187112"
    }
  ]
}
```

The bootstrap contains these fixed classifications and computes SHA-256 from file bytes:

```js
const remoteApplied = [
  ['20260826210617', 'production_runtime_functions', '20260826120000_production_runtime_functions.sql'],
  ['20260826210725', 'revoke_is_admin_anon', '20260826121500_revoke_is_admin_anon.sql'],
  ['20260827051550', 'create_multi_inventory_system', '20260827020755_create_multi_inventory_system.sql'],
  ['20260827051604', 'multi_inventory_runtime_functions', '20260827020830_multi_inventory_runtime_functions.sql'],
  ['20260827051615', 'add_external_prices_name_search_index', '20260827024000_add_external_prices_name_search_index.sql'],
]

const baselinePresent = [
  '20231218_add_tcg_columns.sql',
  '20240701000000_search_functions.sql',
  '202606100001_commission_start_guard.sql',
  '202606100002_add_external_prices_catalog_support.sql',
  '20260615000300_add_admin_manual_buylist_quotes.sql',
  '20260823043500_production_compatibility_baseline.sql',
  '20260823043637_local_security_baseline.sql',
  '20260823044210_fix_merge_duplicate_products_lint.sql',
  '20260823044710_restrict_decrement_stock_rpc.sql',
  '20260823044936_restrict_user_credit_adjustments.sql',
  '20260823050711_local_write_surface_hardening.sql',
  '20260823051113_preserve_production_admin_allowlist.sql',
  '20260823140924_append_import_order_user_note.sql',
  '20260823142117_normalize_import_admin_policies.sql',
  '20260823173257_create_place_order_atomic.sql',
  '20260823183638_create_release_expired_orders_atomic.sql',
]

const forwardPending = ['20260829021742_admin_product_mutations.sql']
```

It refuses to run if the manifest exists, if an array mentions a missing file, or if any migration is absent/duplicated. Run it once to create the committed JSON. The parser independently computes SHA-256 and rejects mismatches; it never rewrites the manifest.

- [ ] **Step 4: Verify candidate blocking and manifest completeness**

Run `npm run test:release-manifest`.

Expected: completeness/hash tests PASS and the explicit candidate-block test PASS.

- [ ] **Step 5: Commit manifest foundation**

```bash
git add package.json scripts/release/migration-manifest.json scripts/release/bootstrap-migration-manifest.mjs scripts/release/migration-manifest.mjs scripts/release/migration-manifest.test.mjs
git commit -m "build: classify crimson migration history"
```

### Task 4: Deterministic release projection

**Files:**
- Create: `scripts/release/build-supabase-projection.mjs`
- Create: `scripts/release/build-supabase-projection.test.mjs`
- Modify: `scripts/release/migration-manifest.mjs`

**Interfaces:**
- Consumes: a fully verified manifest.
- Produces: `buildProjection({ rootDir, outputDir, allowCandidates: false })`.

- [ ] **Step 1: Write failing projection tests**

Build into `mkdtemp()` and assert:

```js
assert.equal(parsedConfig.db.migrations.enabled, true)
assert.deepEqual(
  projectedFiles,
  [
    '20260826210617_production_runtime_functions.sql',
    '20260826210725_revoke_is_admin_anon.sql',
    '20260827051550_create_multi_inventory_system.sql',
    '20260827051604_multi_inventory_runtime_functions.sql',
    '20260827051615_add_external_prices_name_search_index.sql',
    '20260829021742_admin_product_mutations.sql',
  ],
)
```

Remote-applied files contain a comment-only marker with remote version, remote name and local source hash. The forward file is byte-identical to the source. Baseline files are absent.

- [ ] **Step 2: Confirm RED**

Run `node --test scripts/release/build-supabase-projection.test.mjs`.

Expected: FAIL because projection builder does not exist.

- [ ] **Step 3: Implement projection with no shell interpolation**

Use `fs.cp`, `fs.mkdir`, `fs.writeFile` and a small TOML line replacement that requires exactly one `enabled = false` inside `[db.migrations]`. Reject an output inside the repository unless it is under ignored `local-artifacts/release-evidence`. Never copy `.temp`, roles, seeds, dumps or env files.

- [ ] **Step 4: Run projection and manifest tests**

Run:

```powershell
node --test scripts/release/migration-manifest.test.mjs scripts/release/build-supabase-projection.test.mjs
```

Expected: PASS using fixtures. The real manifest still blocks a release projection while equivalences remain `candidate`.

- [ ] **Step 5: Commit projection builder**

```bash
git add scripts/release/build-supabase-projection.mjs scripts/release/build-supabase-projection.test.mjs scripts/release/migration-manifest.mjs
git commit -m "build: generate safe supabase release projection"
```

### Task 5: Dry-run-only release wrapper and runbook

**Files:**
- Create: `scripts/release/run-linked-dry-run.ps1`
- Create: `scripts/release/run-linked-dry-run.test.mjs`
- Create: `docs/runbooks/crimson-release-projection.md`
- Modify: `.gitignore`
- Modify: `package.json`

**Interfaces:**
- Consumes: verified manifest/projection and linked ref.
- Produces: migration list + `db push --linked --dry-run` output only.

- [ ] **Step 1: Write failing wrapper safety contract**

Assert the script contains all required flags and rejects dangerous tokens:

```js
assert.match(source, /--workdir/)
assert.match(source, /link --project-ref djfqozfaqkqdoqeoqbzt/)
assert.match(source, /db push --linked --dry-run/)
assert.match(source, /djfqozfaqkqdoqeoqbzt/)
assert.doesNotMatch(source, /migration repair/)
assert.doesNotMatch(source, /db push --linked(?! --dry-run)/)
assert.match(source, /finally/)
```

- [ ] **Step 2: Run and confirm RED**

Run `node --test scripts/release/run-linked-dry-run.test.mjs`.

Expected: FAIL because the wrapper does not exist.

- [ ] **Step 3: Implement exact-project wrapper**

The wrapper:

1. requires a clean Git worktree;
2. resolves the CLI executable from `node_modules/.bin/supabase.cmd` or an explicit `-SupabaseCli` file parameter;
3. creates `%TEMP%/crimson-release-<guid>`;
4. builds the projection;
5. runs `supabase --workdir <projection> link --project-ref djfqozfaqkqdoqeoqbzt` to create isolated link metadata;
6. reads `<projection>/supabase/.temp/project-ref` and requires exact Crimson production ref;
7. runs `supabase --workdir <projection> migration list --linked`;
8. runs `supabase --workdir <projection> db push --linked --dry-run`;
9. treats “up to date” as failure when `forward_pending` is non-empty;
10. removes the exact temporary directory in `finally` after verifying it is under `%TEMP%` and starts with `crimson-release-`.

The script has no switch capable of removing `--dry-run`.

- [ ] **Step 4: Document evidence and invalid outputs**

The runbook declares these blocking outcomes: `LegacyDbPushMissingLocalError`, candidate equivalence, foreign/missing linked ref, dirty tree, changed hash, an unexpected pending migration, or “up to date” with non-empty forward set. Evidence files contain command, CLI version, Git SHA and migration names only—never passwords, URLs with credentials or SQL data.

- [ ] **Step 5: Verify offline and commit**

Run all release tests, `npm run test:environment-safety`, `npm run typecheck`, and `git diff --check`.

Expected: PASS. Do not execute the linked wrapper until Task 6 evidence is complete.

```bash
git add .gitignore package.json scripts/release/run-linked-dry-run.ps1 scripts/release/run-linked-dry-run.test.mjs docs/runbooks/crimson-release-projection.md
git commit -m "docs: add dry-run-only release gate"
```

### Task 6: Produce read-only equivalence evidence

**Files:**
- Modify: `scripts/release/migration-manifest.json`
- Create: `docs/evidence/crimson-migration-equivalence-2026-08-29.md`

**Interfaces:**
- Consumes: remote migration metadata through read-only Supabase access.
- Produces: five `equivalence: "verified"` entries with evidence links.

- [ ] **Step 1: Capture remote statements and object signatures read-only**

Run only against `djfqozfaqkqdoqeoqbzt`:

```sql
select version, name, statements
from supabase_migrations.schema_migrations
where version in (
  '20260826210617',
  '20260826210725',
  '20260827051550',
  '20260827051604',
  '20260827051615'
)
order by version;
```

Store the raw response only under ignored `local-artifacts/release-evidence/`. The committed evidence document records normalized hashes and schema signatures, not full remote SQL or secrets.

- [ ] **Step 2: Compare each pair**

Normalize line endings and statement terminators, compare the five remote/local pairs, and independently compare created/replaced functions, indexes, policies and grants. A mismatch is recorded as a forward-only remediation and the manifest remains blocked.

- [ ] **Step 3: Verify all baseline-present objects**

Use read-only catalog queries for tables, columns, constraints, functions, `proconfig`, policies and grants. Record pass/fail for every `baseline_present` file. Do not query business-row contents.

- [ ] **Step 4: Mark only proven pairs verified**

Change `equivalence` from `candidate` to `verified`, add `evidence: "docs/evidence/crimson-migration-equivalence-2026-08-29.md#<remote-version>"`, and rerun manifest/projection tests.

Expected: the real projection builds; it contains five markers and all forward migrations only.

- [ ] **Step 5: Run the linked dry-run once**

Run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release/run-linked-dry-run.ps1`.

Expected: read-only output lists exactly the approved forward migrations. Any other result stops execution; do not repair history.

- [ ] **Step 6: Commit evidence, not raw artifacts**

```bash
git add scripts/release/migration-manifest.json docs/evidence/crimson-migration-equivalence-2026-08-29.md
git commit -m "docs: verify crimson migration equivalence"
```

## Plan completion gate

- Environment tests, deployment gate, manifest tests, projection tests and TypeScript all pass.
- The worktree is clean after each task commit.
- The only remote command performed is a read-only metadata query and dry-run.
- No Supabase history, schema, Storage, Vercel variable or deployment is changed.
