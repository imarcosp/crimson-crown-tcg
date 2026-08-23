# Atomic Expired-Order Stock Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the expired-payment cron release each order's reserved stock exactly once, even when cron invocations overlap.

**Architecture:** Add a security-definer PostgreSQL RPC that locks eligible orders, aggregates and locks their products, restores stock, and marks the orders cancelled in one transaction. The Next.js cron route keeps its existing authorization guard and delegates all financial writes to that RPC. A local service-role matrix proves first-call success, second-call idempotency, and anonymous denial.

**Tech Stack:** Supabase local PostgreSQL 17, SQL migration, Next.js route handler, Node test scripts, Supabase JS.

**Spec:** `docs/crimson-crown-backlog.md` P0 financial-flow and rollback requirements.

## Global Constraints

- All SQL and tests target loopback Supabase only; never use `--linked`, production URLs, or provider APIs.
- The route must fail closed outside local when `CRON_SECRET` is missing and must preserve its existing bearer-token check.
- No service-role key may enter browser code or tracked files.
- The RPC must use `security definer`, `set search_path = public, pg_temp`, explicit role checks, row locks, and explicit grants.
- Test fixtures use a unique marker and restore exact stock/order state in `finally`.
- Do not alter the production database or deploy this lot.

---

### Task 1: Add failing local matrix and route contract

**Files:**
- Create: `scripts/local-db/release-stock-atomic-matrix.mjs`
- Create: `scripts/local-db/release-stock-route-contract.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Matrix calls `release_expired_orders_atomic(integer, text)` through the local service-role client.
- Route contract asserts the handler calls that RPC and contains no direct product/order financial updates.

- [x] **Step 1: Write the failing matrix**

Create one expired `pending_payment` marker order and one order item against an in-stock product. Snapshot stock, call the missing RPC, and assert the first call currently fails with an RPC-not-found error. Always delete marker rows and restore the snapshot in `finally`.

- [x] **Step 2: Add idempotency assertions**

After the RPC exists, the matrix must assert: first call returns one cancelled order, stock returns to its snapshot, second call returns zero, stock does not increase again, and an anonymous client cannot invoke the RPC.

- [x] **Step 3: Add the route contract**

Read `src/app/api/cron/release-stock/route.ts` and assert it contains `.rpc('release_expired_orders_atomic'` and does not contain `.from('products').update`, `.from('orders').update`, or `.from('order_items').select`.

- [x] **Step 4: Add package scripts**

Add `test:local-release-stock` and include the contract test in `test:environment-safety`.

### Task 2: Create and apply the local migration

**Files:**
- Create via Supabase CLI: `supabase/migrations/<timestamp>_create_release_expired_orders_atomic.sql`

**Interfaces:**
- Function: `public.release_expired_orders_atomic(p_age_minutes integer default 15, p_payment_marker text default 'Mercado Pago') returns integer`.

- [x] **Step 1: Create the migration shell**

Run `supabase migration new create_release_expired_orders_atomic` from the project directory and use the generated timestamped file.

- [x] **Step 2: Implement the transaction**

The function must reject non-positive age or blank marker, require service-role or `is_admin()`, select matching `pending_payment` orders older than the cutoff `FOR UPDATE SKIP LOCKED`, aggregate their item quantities, lock products `FOR UPDATE`, restore stock, update each still-locked order to `cancelled` with an automatic-release note, and return the number cancelled.

- [x] **Step 3: Revoke and grant explicitly**

Revoke execution from `public`, `anon`, and `authenticated`; grant only to `service_role` and `authenticated` for admin fallback. Keep the function's fixed search path.

- [x] **Step 4: Apply only locally**

Execute the function and grants with `supabase db query --local`, register the generated version with `supabase migration repair ... --status applied --local`, then verify it with `supabase migration list --local` and a definition/grants query. Do not run `migration up --local` against the legacy baseline and do not link the project.

### Task 3: Route the cron through the RPC

**Files:**
- Modify: `src/app/api/cron/release-stock/route.ts`

**Interfaces:**
- The route keeps `GET(req)` and returns the existing JSON success/error shape.

- [x] **Step 1: Replace direct writes**

Keep the authorization and loopback checks, compute the existing 15-minute age, call the RPC with `{ p_age_minutes: 15, p_payment_marker: 'Mercado Pago' }`, and return its integer as the cancellation count. Remove all direct product/order/order-item mutation logic.

- [x] **Step 2: Preserve closed failure behavior**

Return HTTP 401 for a bad bearer token, 503 for missing production secret, and 500 only for RPC/database errors. Never expose keys or raw provider responses.

- [x] **Step 3: Run local tests**

Run the route contract, environment suite, release-stock matrix, financial matrix, and full Playwright suite. The browser suite must still pass without enabling Mercado Pago.

### Task 4: Review and checkpoint

**Files:**
- Modify: `docs/crimson-crown-backlog.md`
- Modify: this plan

- [x] **Step 1: Document the completed local guarantee**

State that expired-order release is idempotent locally while real provider webhook/state reconciliation remains pending.

- [x] **Step 2: Inspect safety**

Run `git diff --check`, inspect the SQL locks/grants, verify no production endpoint or secret was added, and confirm only Crimson Crown files changed.

- [x] **Step 3: Close the owner checkpoint**

Commit and push only the feature branch after the local gate passes. Report the migration status, tests, and the exact production preflight still required before any promotion.
