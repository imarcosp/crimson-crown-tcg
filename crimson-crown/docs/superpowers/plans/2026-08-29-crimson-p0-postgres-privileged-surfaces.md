# Crimson Crown P0 Postgres Privileged Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the exposed definer view, fix every currently reported mutable function search path and document/verify every intentional `SECURITY DEFINER` grant without breaking business RPCs.

**Architecture:** Two forward-only migrations separate the view/search-path fix from any grant change. A machine-readable inventory maps each privileged function to its consumer and allowed role; contract tests and a local matrix prove catalog state and business behavior. Advisor warnings that remain for intentionally authenticated RPCs are recorded with their internal authorization proof.

**Tech Stack:** PostgreSQL 17, Supabase local, SQL, Node 24/`node:test`, Supabase CLI 2.113.0.

**Spec:** `docs/superpowers/specs/2026-08-29-crimson-crown-emergency-hardening-design.md`

## Global Constraints

- Create migration files only with `supabase migration new <name>`.
- Iterate only on `supabase_db_crimson-crown`; do not use `apply_migration` for local work.
- Every exposed table/view requires explicit grants and RLS/underlying authorization.
- Every `SECURITY DEFINER` function has fixed `search_path`, schema-qualified references, explicit grants and internal authorization when browser-callable.
- Do not replace authenticated business RPCs with `service_role` merely to silence an advisor.
- Do not modify production or migration history in this plan.

---

## File map

- Create with CLI: migration ending `_harden_privileged_surfaces.sql`.
- Create with CLI only if the inventory proves additional clear exposure: migration ending `_classify_security_definer_grants.sql`.
- Create `scripts/local-db/privileged-surface-contract.test.mjs`: migration text and inventory contract.
- Create `scripts/local-db/verify-privileged-surfaces.sql`: local catalog assertions.
- Create `scripts/local-db/verify-privileged-surfaces.ps1`: loopback/container-only runner.
- Modify `scripts/local-db/security-matrix.mjs`: negative Data API checks and trigger regressions.
- Create `docs/security/crimson-security-definer-inventory.json`: every function signature, consumer, role and justification.
- Create `docs/security/crimson-security-definer-inventory.md`: human review and accepted-advisor rationale.
- Modify `package.json`: focused privileged-surface test command.

### Task 1: Contract for view, search paths and function inventory

**Files:**
- Create: `scripts/local-db/privileged-surface-contract.test.mjs`
- Create: `docs/security/crimson-security-definer-inventory.json`
- Create: `docs/security/crimson-security-definer-inventory.md`
- Modify: `package.json`

**Interfaces:**
- Produces: inventory entries `{ signature, security, allowedRoles, consumer, authorization }`.
- Produces: contract loader that resolves migrations by suffix, never by invented timestamp.

- [ ] **Step 1: Write the failing contract tests**

Resolve exactly one migration by suffix and require these invariants:

```js
const sql = loadSingleMigration('_harden_privileged_surfaces.sql').toLowerCase()
assert.match(sql, /alter view public\.admin_users set \(security_invoker\s*=\s*true\)/)
assert.match(sql, /revoke all on (table )?public\.admin_users from public, anon, authenticated/)

for (const signature of requiredSearchPathSignatures) {
  assert.ok(
    sql.includes(`alter function public.${signature} set search_path = public, pg_temp`),
    `falta search_path fijo: ${signature}`,
  )
}

const inventory = JSON.parse(await readFile('docs/security/crimson-security-definer-inventory.json'))
assert.equal(new Set(inventory.map((entry) => entry.signature)).size, inventory.length)
for (const entry of inventory) {
  assert.ok(['invoker', 'definer'].includes(entry.security))
  assert.ok(entry.allowedRoles.length > 0)
  assert.ok(entry.consumer.length > 0)
  assert.ok(entry.authorization.length > 0)
}
```

The 24 required signatures are:

```js
[
  'assign_import_order_number()',
  'calculate_import_order_total(bigint)',
  'delete_trash_products(integer)',
  'find_orders_by_id_part(text)',
  'generate_import_order_number()',
  'generate_next_import_order_number()',
  'get_inventory_valuation()',
  'get_trash_products(integer)',
  'handle_new_user()',
  'is_commission_admin()',
  'merge_duplicate_products(integer)',
  'notify_buylist_manager()',
  'notify_credit_change()',
  'notify_import_manager()',
  'notify_order_manager()',
  'notify_stock_alert()',
  'on_commission_adjustments_change()',
  'on_commission_allocations_change()',
  'recalculate_commission_period_status(uuid)',
  'refresh_commission_period(text)',
  'refresh_commission_period(text, numeric, numeric, boolean)',
  'set_import_order_commission_eligible()',
  'set_order_commission_eligible()',
  'sync_product_prices()',
]
```

- [ ] **Step 2: Run and confirm RED**

Run `node --test scripts/local-db/privileged-surface-contract.test.mjs`.

Expected: FAIL because migration and inventory do not exist.

- [ ] **Step 3: Build the exact inventory from catalogs and source**

Query `pg_proc` for `prosecdef`, `proconfig`, `proacl`, identity args and owner in local and production read-only. Search every signature under `src/` and `scripts/`. Classify with these decisions:

- trigger-only functions (`assign_import_order_number`, `handle_new_user`, all `notify_*`, both `on_commission_*`, both `set_*_commission_eligible`, `sync_product_prices`) allow only owner plus `service_role`;
- service-action functions (`refresh_commission_period` overloads, `recalculate_commission_period_status`) allow only `service_role` because `src/app/actions/commissions.ts` calls them with the admin client;
- maintenance/read helpers with no browser consumer (`delete_trash_products`, `get_trash_products`, `get_inventory_valuation`, `generate_import_order_number`, `generate_next_import_order_number`, `find_orders_by_id_part`, `merge_duplicate_products`, `calculate_import_order_total`) allow only `service_role`; catalog and trigger dependencies are recorded as their consumers;
- `is_commission_admin()` allows `authenticated` and `service_role` because policies may evaluate it; it must not allow `anon`/`PUBLIC`;
- client business RPCs outside this 24-function list remain authenticated only when their body validates `auth.uid()` ownership or `public.is_admin()`.

The catalog dependency query must include `pg_trigger`: it proves which functions run only as triggers and prevents mistaking the absence of a TypeScript callsite for absence of a database consumer. Every exception in the Markdown document includes the exact function signature and source/migration line or trigger that enforces authorization.

- [ ] **Step 4: Rerun the inventory-only tests**

Expected: inventory completeness PASS; migration assertions remain RED.

- [ ] **Step 5: Commit the reviewed inventory**

```bash
git add package.json docs/security/crimson-security-definer-inventory.json docs/security/crimson-security-definer-inventory.md scripts/local-db/privileged-surface-contract.test.mjs
git commit -m "docs: classify privileged postgres functions"
```

### Task 2: Forward-only view and search-path migration

**Files:**
- Create with CLI: the file printed by `supabase migration new harden_privileged_surfaces`, whose basename ends `_harden_privileged_surfaces.sql`.
- Modify: `scripts/local-db/privileged-surface-contract.test.mjs`

**Interfaces:**
- Consumes: Task 1 inventory.
- Produces: invoker view, fixed paths and explicit grants for the 24 reported signatures.

- [ ] **Step 1: Create the migration with the CLI**

Run:

```powershell
supabase migration new harden_privileged_surfaces
```

Use the exact path printed by the CLI. Do not rename or invent its timestamp.

- [ ] **Step 2: Write the migration inside one transaction**

The migration starts with:

```sql
begin;

alter view public.admin_users set (security_invoker = true);
revoke all on table public.admin_users from public, anon, authenticated;

alter function public.assign_import_order_number() set search_path = public, pg_temp;
alter function public.calculate_import_order_total(bigint) set search_path = public, pg_temp;
alter function public.delete_trash_products(integer) set search_path = public, pg_temp;
alter function public.find_orders_by_id_part(text) set search_path = public, pg_temp;
alter function public.generate_import_order_number() set search_path = public, pg_temp;
alter function public.generate_next_import_order_number() set search_path = public, pg_temp;
alter function public.get_inventory_valuation() set search_path = public, pg_temp;
alter function public.get_trash_products(integer) set search_path = public, pg_temp;
alter function public.handle_new_user() set search_path = public, pg_temp;
alter function public.is_commission_admin() set search_path = public, pg_temp;
alter function public.merge_duplicate_products(integer) set search_path = public, pg_temp;
alter function public.notify_buylist_manager() set search_path = public, pg_temp;
alter function public.notify_credit_change() set search_path = public, pg_temp;
alter function public.notify_import_manager() set search_path = public, pg_temp;
alter function public.notify_order_manager() set search_path = public, pg_temp;
alter function public.notify_stock_alert() set search_path = public, pg_temp;
alter function public.on_commission_adjustments_change() set search_path = public, pg_temp;
alter function public.on_commission_allocations_change() set search_path = public, pg_temp;
alter function public.recalculate_commission_period_status(uuid) set search_path = public, pg_temp;
alter function public.refresh_commission_period(text) set search_path = public, pg_temp;
alter function public.refresh_commission_period(text, numeric, numeric, boolean) set search_path = public, pg_temp;
alter function public.set_import_order_commission_eligible() set search_path = public, pg_temp;
alter function public.set_order_commission_eligible() set search_path = public, pg_temp;
alter function public.sync_product_prices() set search_path = public, pg_temp;
```

Then apply these explicit grants. Every function in this advisor batch is internal/service-only except `is_commission_admin()`, which policies may execute as an authenticated user:

```sql
revoke all on function public.assign_import_order_number() from public, anon, authenticated;
grant execute on function public.assign_import_order_number() to service_role;
revoke all on function public.calculate_import_order_total(bigint) from public, anon, authenticated;
grant execute on function public.calculate_import_order_total(bigint) to service_role;
revoke all on function public.delete_trash_products(integer) from public, anon, authenticated;
grant execute on function public.delete_trash_products(integer) to service_role;
revoke all on function public.find_orders_by_id_part(text) from public, anon, authenticated;
grant execute on function public.find_orders_by_id_part(text) to service_role;
revoke all on function public.generate_import_order_number() from public, anon, authenticated;
grant execute on function public.generate_import_order_number() to service_role;
revoke all on function public.generate_next_import_order_number() from public, anon, authenticated;
grant execute on function public.generate_next_import_order_number() to service_role;
revoke all on function public.get_inventory_valuation() from public, anon, authenticated;
grant execute on function public.get_inventory_valuation() to service_role;
revoke all on function public.get_trash_products(integer) from public, anon, authenticated;
grant execute on function public.get_trash_products(integer) to service_role;
revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to service_role;
revoke all on function public.is_commission_admin() from public, anon;
grant execute on function public.is_commission_admin() to authenticated, service_role;
revoke all on function public.merge_duplicate_products(integer) from public, anon, authenticated;
grant execute on function public.merge_duplicate_products(integer) to service_role;
revoke all on function public.notify_buylist_manager() from public, anon, authenticated;
grant execute on function public.notify_buylist_manager() to service_role;
revoke all on function public.notify_credit_change() from public, anon, authenticated;
grant execute on function public.notify_credit_change() to service_role;
revoke all on function public.notify_import_manager() from public, anon, authenticated;
grant execute on function public.notify_import_manager() to service_role;
revoke all on function public.notify_order_manager() from public, anon, authenticated;
grant execute on function public.notify_order_manager() to service_role;
revoke all on function public.notify_stock_alert() from public, anon, authenticated;
grant execute on function public.notify_stock_alert() to service_role;
revoke all on function public.on_commission_adjustments_change() from public, anon, authenticated;
grant execute on function public.on_commission_adjustments_change() to service_role;
revoke all on function public.on_commission_allocations_change() from public, anon, authenticated;
grant execute on function public.on_commission_allocations_change() to service_role;
revoke all on function public.recalculate_commission_period_status(uuid) from public, anon, authenticated;
grant execute on function public.recalculate_commission_period_status(uuid) to service_role;
revoke all on function public.refresh_commission_period(text) from public, anon, authenticated;
grant execute on function public.refresh_commission_period(text) to service_role;
revoke all on function public.refresh_commission_period(text, numeric, numeric, boolean) from public, anon, authenticated;
grant execute on function public.refresh_commission_period(text, numeric, numeric, boolean) to service_role;
revoke all on function public.set_import_order_commission_eligible() from public, anon, authenticated;
grant execute on function public.set_import_order_commission_eligible() to service_role;
revoke all on function public.set_order_commission_eligible() from public, anon, authenticated;
grant execute on function public.set_order_commission_eligible() to service_role;
revoke all on function public.sync_product_prices() from public, anon, authenticated;
grant execute on function public.sync_product_prices() to service_role;
commit;
```

Do not use dynamic SQL. Preserve owner privileges. `delete_trash_products`, `merge_duplicate_products`, `get_inventory_valuation`, `get_trash_products` and `find_orders_by_id_part` are service-only because they expose or mutate broad product/order state and have no authenticated application consumer. `calculate_import_order_total` is consumed by the service-only commission refresh.

- [ ] **Step 3: Run the text contract and confirm GREEN**

Run `npm run test:privileged-surfaces`.

Expected: migration suffix, all 24 search paths, view options and grants PASS.

- [ ] **Step 4: Apply only to the local Crimson container**

Resolve the generated migration and pipe it to the exact local container:

```powershell
$migration = Get-ChildItem supabase/migrations/*_harden_privileged_surfaces.sql | Select-Object -Single
Get-Content -Raw -LiteralPath $migration.FullName | docker exec -i supabase_db_crimson-crown psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1
```

Expected: `BEGIN`, `ALTER VIEW`, 24 `ALTER FUNCTION` operations, grants, `COMMIT`; no other Docker container is referenced.

- [ ] **Step 5: Commit the migration**

```bash
git add supabase/migrations/*_harden_privileged_surfaces.sql scripts/local-db/privileged-surface-contract.test.mjs
git commit -m "security: harden privileged postgres surfaces"
```

### Task 3: Catalog verifier and negative authorization matrix

**Files:**
- Create: `scripts/local-db/verify-privileged-surfaces.sql`
- Create: `scripts/local-db/verify-privileged-surfaces.ps1`
- Modify: `scripts/local-db/security-matrix.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 2 local schema.
- Produces: local catalog/behavior gate with non-zero exit on drift.

- [ ] **Step 1: Write failing SQL assertions**

The SQL uses `DO` blocks to assert:

```sql
if not exists (
  select 1
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'admin_users'
    and 'security_invoker=true' = any(c.reloptions)
) then raise exception 'admin_users no es security_invoker'; end if;

if has_table_privilege('anon', 'public.admin_users', 'select')
   or has_table_privilege('authenticated', 'public.admin_users', 'select') then
  raise exception 'admin_users sigue expuesta';
end if;
```

Loop over the JSON inventory loaded into a temporary table and assert `proconfig` contains `search_path=public, pg_temp` and role privileges match `allowedRoles`.

- [ ] **Step 2: Write the loopback-only runner**

The PowerShell script requires `.env.test.local`, confirms host loopback/port `54621`, requires exact container name `supabase_db_crimson-crown`, then executes the SQL with `ON_ERROR_STOP=1`. It never accepts a container parameter.

- [ ] **Step 3: Extend Data API checks**

Add to `security-matrix.mjs`:

```js
const viewProbe = await anon.from('admin_users').select('id').limit(1)
assert.ok(viewProbe.error)

for (const functionName of triggerOnlyFunctions) {
  const anonProbe = await anon.rpc(functionName)
  const userProbe = await standard.rpc(functionName)
  assert.ok(anonProbe.error, `${functionName} no debe aceptar anon`)
  assert.ok(userProbe.error, `${functionName} no debe aceptar authenticated`)
}
```

Do not invoke trigger functions with row-shaped fake payloads; permission denial must happen before execution.

- [ ] **Step 4: Run full local regressions**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/local-db/verify-privileged-surfaces.ps1
npm run test:local-security
npm run test:local-financial
npm run test:local-atomic-checkout
npm run test:local-release-stock
npm run test:local-multi-inventory
npm run test:local-admin-products
```

Expected: all PASS; synthetic fixtures are cleaned.

- [ ] **Step 5: Commit verifier and matrix**

```bash
git add package.json scripts/local-db/verify-privileged-surfaces.sql scripts/local-db/verify-privileged-surfaces.ps1 scripts/local-db/security-matrix.mjs
git commit -m "test: verify privileged postgres authorization"
```

### Task 4: Advisor delta and accepted-warning report

**Files:**
- Modify: `docs/security/crimson-security-definer-inventory.md`
- Create: `docs/evidence/crimson-p0-security-advisor-baseline.md`

**Interfaces:**
- Consumes: local verification and future staging advisor output.
- Produces: exact expected delta; no blanket “zero warnings” requirement.

- [ ] **Step 1: Capture local catalog counts**

Record count of mutable paths, definer functions executable by `anon` and definer functions executable by `authenticated`. The expected local result is zero mutable paths for the 24 signatures, zero `anon` access to privileged functions, and authenticated access only for inventory-listed business RPCs.

- [ ] **Step 2: Document intentional authenticated definer RPCs**

For each retained function, cite its ownership/admin check and a positive plus negative matrix test. A warning without both proofs is blocking.

- [ ] **Step 3: Verify lint and diff**

Run:

```powershell
supabase db lint --local --schema public --level warning --fail-on error
npm run test:privileged-surfaces
npm run typecheck
git diff --check
```

Expected: no lint error, tests/typecheck PASS.

- [ ] **Step 4: Commit evidence**

```bash
git add docs/security/crimson-security-definer-inventory.md docs/evidence/crimson-p0-security-advisor-baseline.md
git commit -m "docs: record privileged surface security baseline"
```

## Plan completion gate

- `admin_users` is invoker and inaccessible through Data API roles.
- All 24 remotely reported functions have fixed paths in the forward migration.
- Trigger/internal functions are not invocable by `anon` or ordinary users.
- Authenticated business RPCs remain only with internal authorization and tests.
- All local financial, inventory and authorization matrices remain green.
- No production mutation has occurred.
