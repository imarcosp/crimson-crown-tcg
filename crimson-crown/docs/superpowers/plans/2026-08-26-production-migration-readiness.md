# Crimson Crown Production Migration Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a dependency-safe, locally verified migration sequence that can later be reviewed before any Crimson Crown production database change.

**Architecture:** Keep the existing production schema as the source of truth and add a small compatibility migration before the newer atomic RPC migrations. Keep RLS hardening and Storage policy changes separate so each production risk is reviewable. All work runs against local Supabase or the local schema dump only.

**Tech Stack:** Supabase CLI migrations, PostgreSQL 17, Node.js test runner, existing Crimson Crown local matrices.

**Spec:** `docs/crimson-crown-backlog.md`

## Global Constraints

- Never run `supabase db push`, `supabase db reset --linked`, remote SQL, remote tests, Vercel deployment, or production environment mutation.
- Do not modify historical migrations already applied locally; add forward-only migrations.
- Do not copy production rows, Auth secrets, Storage objects, or provider credentials into Git.
- Production order is compatibility baseline, atomic RPCs, then policy hardening and Storage after separate review.
- `public.is_admin()` is callable only by `authenticated` and `service_role`.

---

### Task 1: Add a migration-order and privilege contract

**Files:**
- Create: `scripts/local-db/production-migration-readiness.test.mjs`
- Modify: `package.json`

**Interfaces:**
- The test locates exactly one `*_production_compatibility_baseline.sql` file and compares its filename with both atomic migrations.
- The test checks that the compatibility SQL defines `public.is_admin()`, removes legacy public grants, and grants administrative functions only to `authenticated`/`service_role`.

- [x] **Step 1: Write the failing contract test**

Read `supabase/migrations` with `readdirSync`, require one compatibility migration, assert its filename sorts before `20260823173257_create_place_order_atomic.sql` and `20260823183638_create_release_expired_orders_atomic.sql`, and assert the SQL contains `create or replace function public.is_admin`, `drop function if exists public.decrement_stock(integer, uuid)`, `revoke all on function public.is_admin() from public`, and `grant execute on function public.is_admin() to authenticated, service_role`.

- [x] **Step 2: Run the contract test and verify the expected failure**

Run `node --test scripts/local-db/production-migration-readiness.test.mjs`. It must fail because the compatibility migration does not exist yet.

- [x] **Step 3: Add the test to `test:environment-safety`**

Append the new test path to the existing script without changing any existing test entry.

---

### Task 2: Add the production compatibility migration

**Files:**
- Create: `supabase/migrations/*_production_compatibility_baseline.sql`

**Interfaces:**
- Produces `public.is_admin()` for later atomic functions.
- Replaces legacy `public.decrement_stock(integer, uuid)` with a boolean, authorized implementation.
- Hardens `public.restore_stock(uuid)` without changing its signature.

- [x] **Step 1: Create the migration through the Supabase CLI**

Run `supabase migration new production_compatibility_baseline` from the repository root. If the generated timestamp sorts after either atomic migration, rename only this not-yet-applied file to an unused timestamp before both atomic migrations; never rename or edit an existing migration.

- [x] **Step 2: Implement the transaction**

The SQL must run in one transaction and implement these exact rules:

```sql
create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and (role = 'admin' or lower(email) in ('mjperchezabala@gmail.com', 'crimsoncrownimports@gmail.com'))
  );
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated, service_role;

drop function if exists public.decrement_stock(integer, uuid);
create function public.decrement_stock(qty integer, row_id uuid)
returns boolean
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), 'anon') <> 'service_role' and not public.is_admin() then
    raise exception 'Sin permiso.' using errcode = '42501';
  end if;
  if qty is null or qty <= 0 then
    raise exception 'Cantidad inválida.' using errcode = '22023';
  end if;
  update public.products set stock = stock - qty
    where id = row_id and coalesce(stock, 0) >= qty;
  return found;
end;
$$;
revoke all on function public.decrement_stock(integer, uuid) from public, anon, authenticated;
grant execute on function public.decrement_stock(integer, uuid) to authenticated, service_role;
```

Also replace `restore_stock(uuid)` with the same authorization/search-path protections and revoke its `anon` grant. Do not alter RLS policies in this migration.

- [x] **Step 3: Run the contract test and verify it passes**

Run `node --test scripts/local-db/production-migration-readiness.test.mjs` and confirm the migration order and grants pass.

---

### Task 3: Apply and verify only in local Supabase

**Files:**
- Modify: `docs/crimson-crown-backlog.md`
- Modify: this plan

**Interfaces:**
- Local `pg_proc` exposes the signatures expected by `place_order_atomic` and `release_expired_orders_atomic`.
- No remote migration history, remote data, or Vercel configuration changes.

- [x] **Step 1: Apply the generated SQL to loopback**

The local CLI rejected the multi-statement file as a prepared statement, so the migration was executed inside the explicit `supabase_db_crimson-crown` container as `supabase_admin` (the local function owner). Query local `pg_proc` to verify `is_admin()` returns `boolean`, `decrement_stock(integer,uuid)` returns `boolean`, and `restore_stock(uuid)` returns `void`. No linked project was used.

- [x] **Step 2: Run local gates**

Run the migration contract, local Supabase lint, `npm run test:local-security`, `npm run test:local-atomic-checkout`, and `npm run test:local-release-stock`, all against loopback.

- [x] **Step 3: Document the stop point**

Record that the compatibility migration is verified locally but not applied remotely. Keep Storage audit, payment/webhook design, full TypeScript validation, and owner review marked as production blockers.

- [ ] **Step 4: Commit the local-only checkpoint**

After all local gates pass:

```powershell
git add supabase/migrations scripts/local-db/production-migration-readiness.test.mjs package.json docs/crimson-crown-backlog.md docs/superpowers/plans/2026-08-26-production-migration-readiness.md
git commit -m "chore: prepare production migration compatibility checkpoint"
```

Do not push to `main`, run `supabase db push`, or deploy Vercel.

---

### Task 4: TypeScript release gate (separate follow-up lot)

**Files:**
- Modify only files named by a fresh `tsc --noEmit` run.

**Interfaces:**
- The follow-up lot must make strict TypeScript validation pass without weakening `strict` or adding broad `@ts-ignore`/`@ts-nocheck` directives.

- [ ] **Step 1: Keep separate from SQL compatibility**

Create a separate plan and commit for TypeScript cleanup after this migration checkpoint is reviewed; do not mix unrelated type fixes into the database release diff.
