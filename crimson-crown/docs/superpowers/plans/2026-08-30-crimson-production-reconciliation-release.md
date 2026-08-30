# Crimson Production Reconciliation and Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every fail-closed historical migration proof without replaying legacy SQL or rewriting business rows, then release the ten already-rehearsed Crimson changes to the exact production projects.

**Architecture:** A focused forward-only reconciliation migration establishes the safe current intent for legacy search, commission retention, defaults, and RLS/ACL drift. A read-only verifier records one explicit PASS anchor per historical manifest entry; the linked projection remains unchanged and may run only after every candidate is replaced by evidence-backed proof. Application-compatible database migrations precede the Vercel release, while Storage hardening remains the last production mutation.

**Tech Stack:** PostgreSQL 17 / Supabase CLI 2.113.0, Node.js 22 test runner, Next.js 16.3.3, PowerShell 5.1, Vercel CLI.

**Spec:** `docs/evidence/crimson-migration-equivalence-2026-08-29.md`

## Global Constraints

- Work only in Crimson Crown; do not read or modify Che Maracucho, and do not write to El Perchero TCG.
- Never run `db reset`, remote `migration repair`, historical replay, or broad `db push` against production.
- Never delete or rewrite production orders, users, products, inventory, commissions, or Storage objects; retain the 9 aggregate-observed commission periods before 2026-06.
- Do not convert `external_prices.color_identity`; production JSONB is the application-compatible canonical type.
- Do not implement Mercado Pago or SaaS work.
- Exact production Supabase project: `djfqozfaqkqdoqeoqbzt`.
- Exact staging Supabase project: `ssyeqgtdohwkcucedpwx`.
- Exact production Vercel project: `crimson-crown-tcg` / `prj_wHaQDSKDKuTP4rPoS1SeCFulls8g`.
- Keep `20260829235900_harden_storage_buckets_and_policies.sql` logically and physically last; the reconciliation version is fixed at `20260829235800`, immediately before it.
- All production preflight and postflight queries are aggregate or catalog-only and must not emit PII, object paths, credentials, or business-row contents.

---

### Task 1: Contract the safe reconciliation boundary

**Files:**
- Create: `scripts/local-db/production-reconciliation-contract.test.mjs`
- Test: `scripts/local-db/production-reconciliation-contract.test.mjs`

**Interfaces:**
- Consumes: legacy migration filenames and the current forward manifest.
- Produces: a contract for `20260829235800_reconcile_legacy_schema_safely.sql`, immediately before the existing final Storage migration.

- [ ] **Step 1: Write the failing static contract**

```js
test('reconciles legacy intent without business-row DML or type conversion', () => {
  const sql = readMigration('_reconcile_legacy_schema_safely.sql')
  assert.doesNotMatch(sql, /\b(?:delete|update)\s+(?:from\s+)?public\./iu)
  assert.doesNotMatch(sql, /alter\s+column\s+color_identity\s+type/iu)
  assert.match(sql, /alter\s+column\s+tcg\s+set\s+default\s+'Magic'/iu)
  assert.match(sql, /commission_periods_start_period_chk[\s\S]*not\s+valid/iu)
  assert.doesNotMatch(sql, /validate\s+constraint\s+commission_periods_start_period_chk/iu)
  assert.match(sql, /drop\s+policy\s+if\s+exists\s+"Service role updates"/iu)
  assert.match(sql, /create\s+policy\s+"Admins manage external prices"/iu)
  assert.match(sql, /create\s+policy\s+"Admins manage all import orders"/iu)
  assert.match(sql, /drop\s+function\s+if\s+exists\s+public\.search_orders_v2/iu)
  assert.match(sql, /drop\s+function\s+if\s+exists\s+public\.search_imports_v2/iu)
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test scripts/local-db/production-reconciliation-contract.test.mjs`

Expected: FAIL because the reconciliation migration does not exist.

- [ ] **Step 3: Add runtime-catalog assertions to the same test**

The test must execute the exact migration, including its own explicit `BEGIN/COMMIT`, on `supabase_db_crimson-crown`; assert zero changes to full-row counts/checksums for `orders`, `profiles`, `products`, and `inventory_stock_movements`; and assert the intended policies, grants, defaults, explicit absence of the retired search RPCs, exactly nine retained periods, and an unvalidated (`convalidated = false`) commission constraint. Endpoint rollback is proven separately with an intentionally failing transaction in isolated staging.

- [ ] **Step 4: Re-run and retain the expected RED result**

Run the same focused command and confirm it still fails only because the migration is absent.

### Task 2: Implement the forward-only reconciliation

**Files:**
- Create: `supabase/migrations/20260829235800_reconcile_legacy_schema_safely.sql`
- Test: `scripts/local-db/production-reconciliation-contract.test.mjs`

**Interfaces:**
- Consumes: `public.is_admin()`, current JSONB `external_prices.color_identity`, current bigint import-order IDs.
- Produces: safe legacy reconciliation while the existing final Storage migration remains ordered after it.

- [ ] **Step 1: Implement only non-row-mutating schema intent**

The migration must:

```sql
begin;
alter table public.products alter column tcg set default 'Magic';
-- Explicitly retire the unused legacy search RPCs; their import return shape is incompatible with the current bigint schema.
drop function if exists public.search_orders_v2(text, text, boolean, integer, integer);
drop function if exists public.search_imports_v2(text, boolean, text, text, integer, integer);
drop function if exists public.normalize_text(text);
-- Add commission_periods_start_period_chk NOT VALID and do not validate it, preserving 9 legacy periods while enforcing future writes.
-- Preserve JSONB color_identity and document it as canonical; never convert it.
-- Replace only the unsafe external_prices, price_history, import_orders, and import_items policies.
commit;
```

All helper functions must use qualified relations, fixed `search_path = public, extensions, pg_temp`, invoker security unless a tested definer is required, and service-role-only execution.

- [ ] **Step 2: Run the focused contract and verify GREEN**

Run: `node --test scripts/local-db/production-reconciliation-contract.test.mjs`

Expected: all static and rollback runtime checks pass.

- [ ] **Step 3: Run local database lint**

Run: `supabase db lint --local --schema public --level warning --fail-on error`

Expected: no schema errors.

- [ ] **Step 4: Run all local mutating matrices serially**

Run the security, financial, checkout, stock, multi-inventory, admin-product, import, commission, and Storage matrices one at a time. Expected: no failures and no residual fixtures.

### Task 3: Create evidence-backed manifest proofs

**Files:**
- Create: `scripts/release/production-reconciliation-evidence-contract.test.mjs`
- Create: `scripts/release/production-reconciliation-preflight.sql`
- Create: `docs/evidence/crimson-production-reconciliation-2026-08-30.md`
- Modify: `scripts/release/migration-manifest.json`
- Modify: `scripts/release/bootstrap-migration-manifest.mjs`
- Modify: `scripts/release/migration-manifest.test.mjs`

**Interfaces:**
- Consumes: read-only production catalog result and the reconciliation migration hash.
- Produces: 21 unique safe Markdown anchors and a manifest with no candidates.

- [ ] **Step 1: Write a failing evidence contract**

The contract must require exactly 21 unique ASCII ATX anchors, reject any `Blocked`/`FAIL` decision, require seven strictly verified-present entries (the five exact remote-ledger migrations plus two independently proven baseline effects), and require every reconciled entry to reference the exact forward set that establishes its intent. This supersedes the earlier four-entry expectation after the fresh reproducible production preflight proved the three superseded remote pairs semantically present.

- [ ] **Step 2: Verify RED**

Run: `node --test scripts/release/production-reconciliation-evidence-contract.test.mjs scripts/release/migration-manifest.test.mjs`

Expected: FAIL while the real manifest contains candidates and the new evidence file is absent.

- [ ] **Step 3: Add a read-only preflight query**

The SQL may read only `pg_catalog`, `information_schema`, aggregate counts, and hashes. It must return no emails, row payloads, proof paths, object names, credentials, URLs, or function bodies.

- [ ] **Step 4: Record fresh production evidence**

Create one PASS heading for each historical version, stating whether current intent is verified directly or reconciled by an exact forward version. Include project ref, timestamp, migration ledger, aggregate pre-start commission count, and normalized catalog hashes.

- [ ] **Step 5: Update the manifest without weakening validation**

Use `verified_present` only for state already proven in production. Use `forward_reconciled` only when the exact pending reconciliation migration supplies the missing intent. Leave the manifest parser and dry-run wrapper unchanged.

- [ ] **Step 6: Verify GREEN**

Run the focused evidence, manifest, projection, and linked-wrapper contract suites. Expected: all pass and the real manifest loads with zero candidates.

### Task 4: Rehearse the added reconciliation in staging

**Files:**
- Modify: `scripts/staging/run-p0-rehearsal.ps1`
- Modify: `scripts/staging/run-p0-rehearsal.test.mjs`
- Modify: `docs/runbooks/crimson-staging.md`
- Test: `e2e/staging/p0-smoke.spec.ts`

**Interfaces:**
- Consumes: reconciliation SQL and renamed Storage SQL.
- Produces: exact staging ledger/hash proof, before/after/rollback snapshots, and two clean E2E passes.

- [ ] **Step 1: Update the failing staging ledger contract**

Require the reconciliation source hash immediately before the existing final Storage source hash. Verify RED against the old wrapper inventory.

- [ ] **Step 2: Update wrapper and runbook inventory**

Add the reconciliation entry and keep Storage last. Do not add an apply mode that can target production.

- [ ] **Step 3: Apply only the new reconciliation migration to exact staging**

Use the Supabase migration connector with project `ssyeqgtdohwkcucedpwx`. Do not reapply old migrations or alter staging-only scope.

- [ ] **Step 4: Run verify-only rehearsal**

Expected: exact ledger, exact hashes, snapshots equivalent, and zero remote mutations by the verifier.

- [ ] **Step 5: Run two complete staging E2E passes**

Expected: all flows pass twice and fixture cleanup returns counts to zero.

### Task 5: Commit, review, and execute the linked production dry-run

**Files:**
- Modify: `docs/evidence/crimson-production-reconciliation-2026-08-30.md` only if the final hashes require it.

**Interfaces:**
- Consumes: clean committed evidence and candidate-free manifest.
- Produces: exact linked dry-run output listing every approved forward once and in order.

- [ ] **Step 1: Run full verification**

Run `git diff --check`, TypeScript, Next build, all release tests, all environment-safety tests, Supabase lint, serialized local matrices, staging rehearsal, and staged E2E.

- [ ] **Step 2: Obtain independent review**

Require PASS on data safety, migration order, proof correctness, ACL/RLS behavior, and rollback-forward notes.

- [ ] **Step 3: Commit the reconciliation and evidence**

Create a local commit only after the staged diff contains no secrets and generated test artifacts are excluded.

- [ ] **Step 4: Run the exact linked dry-run**

Use CLI `2.113.0`, exact production ref, and the unchanged wrapper. Expected: the approved forward filenames exactly once in manifest order; no apply command.

### Task 6: Production preflight and release

**Files:**
- No repository edits during release.

**Interfaces:**
- Consumes: committed release SHA, completed backup, preflight snapshots, linked dry-run PASS.
- Produces: production migration ledger, Vercel deployment ID, postflight equivalence evidence.

- [ ] **Step 1: Verify production identity and backup**

Require exact Supabase/Vercel IDs, ACTIVE/READY status, and a fresh completed physical backup. Capture aggregate row counts/checksums and Storage count/hash snapshots without object paths.

- [ ] **Step 2: Apply pre-Storage migrations individually**

Use the exact reviewed SQL through `apply_migration`, one migration at a time and in manifest order. Never invoke repair, reset, or historical SQL. Verify catalog/data invariants after each sensitive phase.

- [ ] **Step 3: Deploy the exact production Vercel project**

Relink `.vercel/project.json` to `prj_wHaQDSKDKuTP4rPoS1SeCFulls8g`, verify production environment metadata, deploy the committed tree, and require READY plus public smoke checks.

- [ ] **Step 4: Apply final Storage hardening**

Apply the existing final Storage migration only after the compatible app is READY. Confirm bucket settings, policies, object counts/hashes, and signed read/upload flows.

- [ ] **Step 5: Run production postflight**

Require unchanged orders/users/products/inventory counts and checksums, unchanged Storage object counts/hashes, expected path-column backfills only if explicitly present, valid migration ledger, and security/performance advisor review.

### Task 7: Push and handoff

**Files:**
- No new code.

**Interfaces:**
- Consumes: verified production state and clean commits.
- Produces: pushed Crimson branch and release report.

- [ ] **Step 1: Push only the Crimson branch**

Push `codex/crimson-remaining-backlog`; do not merge or touch another repository.

- [ ] **Step 2: Report the release**

Provide commit SHA, Supabase migration versions/names, Vercel deployment ID/URL, verification results, unchanged-data evidence, and any deferred work. Mercado Pago and SaaS remain excluded.
