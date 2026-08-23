# Atomic Checkout Rollback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the local checkout reserve stock, consume credits, create the order, and create its items in one Supabase transaction so any failure rolls back every financial mutation.

**Architecture:** Add one security-definer PostgreSQL function, `public.place_order_atomic`, as the single write boundary for checkout. The function locks products/profile rows, calculates prices/coupons/credits from database values, writes the order and items, and raises on invalid input; PostgreSQL then rolls back stock and credits automatically. The Next.js action keeps contact-profile persistence and email delivery outside that transaction, and reads the committed order only after the RPC succeeds.

**Tech Stack:** Supabase local PostgreSQL 17, SQL migration, Supabase JS RPC, Next.js server action, Node test scripts, Playwright E2E.

**Spec:** `docs/crimson-crown-backlog.md` P0 financial-flow and rollback requirements.

## Global Constraints

- All database execution and tests must target loopback Supabase only (`127.0.0.1`, `localhost`, or `::1`).
- Never expose `SUPABASE_SERVICE_ROLE_KEY` to browser code or test output.
- Never call Mercado Pago, Resend, or any production endpoint from automated tests.
- No production migration, `db push --linked`, deploy, or production data mutation is allowed in this lot.
- The SQL function must validate `auth.uid()`, use a fixed `search_path`, lock rows before mutation, and have explicit grants.
- Every fixture test must restore stock/credits and delete created orders/items in `finally` cleanup.

---

### Task 1: Add the failing atomic rollback matrix

**Files:**
- Create: `scripts/local-db/checkout-atomic-matrix.mjs`
- Modify: `package.json` (`test:local-atomic-checkout` script)

**Interfaces:**
- Consumes: local Supabase REST RPC `place_order_atomic` with `p_items`, `p_delivery_method`, `p_shipping_address`, `p_use_credits`, and contact parameters.
- Produces: a local-only executable that proves an invalid second item rolls back the first product reservation, credit balance, credit transaction, order, and order items.

- [x] **Step 1: Write the failing test**

Create a script that validates loopback credentials, snapshots a standard profile and an in-stock product, grants only a temporary credit balance through the service client, and calls:

```js
await standard.rpc('place_order_atomic', {
  p_items: [
    { id: product.id, quantity: 1 },
    { id: 'ffffffff-ffff-ffff-ffff-ffffffffffff', quantity: 1 },
  ],
  p_coupon_code: null,
  p_delivery_method: 'pickup [Pago: Efectivo]',
  p_shipping_address: null,
  p_use_credits: true,
  p_contact_name: 'Atomic',
  p_contact_lastname: 'Rollback',
  p_contact_phone: '+5491100000001',
})
```

The expected result before the function exists is an RPC-not-found error. After implementation, the call must error and the script must assert that product stock, profile credits, credit transaction count, and marker orders are unchanged.

- [x] **Step 2: Run test to verify it fails**

Run: `node scripts/local-db/checkout-atomic-matrix.mjs`

Expected: FAIL because `place_order_atomic` does not exist yet.

- [x] **Step 3: Add the package entry point**

Add `"test:local-atomic-checkout": "node scripts/local-db/checkout-atomic-matrix.mjs"` beside the existing local security/financial scripts.

- [x] **Step 4: Keep the test fixture cleanup unconditional**

In `finally`, delete only marker orders/transactions and restore the exact original `stock` and `credits` values, even when the RPC is unavailable or fails.

### Task 2: Create and apply the local transaction migration

**Files:**
- Create via Supabase CLI: `supabase/migrations/<timestamp>_create_place_order_atomic.sql`

**Interfaces:**
- Consumes: authenticated caller identity and the existing `products`, `coupons`, `profiles`, `orders`, `order_items`, and `credit_transactions` tables.
- Produces: `public.place_order_atomic(...) returns uuid`.

- [x] **Step 1: Create the migration shell**

Run `supabase migration new create_place_order_atomic` from the Crimson Crown project, then fill the generated file. Do not invent a timestamp or use `apply_migration`.

- [x] **Step 2: Implement the function transaction boundary**

The function must:

1. Reject a missing `auth.uid()`, missing contact fields, empty items, non-positive quantities, unknown delivery methods, and incomplete `moto`/`shipping` addresses.
2. Aggregate duplicate product IDs from `p_items` and lock each product with `FOR UPDATE` before checking stock or changing it.
3. Resolve prices and optional active coupons from the database, never trusting browser prices.
4. Lock the caller profile with `FOR UPDATE`, apply at most the available credits, insert a `purchase` credit transaction referencing the new order, and set `paid` only when the remaining total is zero.
5. Insert the order and order items using the resolved prices, then return the order UUID.
6. Use `security definer`, `set search_path = public, pg_temp`, an explicit `auth.uid()` ownership check, `revoke all ... from public, anon`, and `grant execute ... to authenticated, service_role`.

- [x] **Step 3: Apply only to the local database**

The normal `migration up --local` path attempted to replay the legacy baseline and stopped because the local role does not own `products`. The new function was therefore executed with `db query --local` as one SQL statement, its explicit grants were applied separately, and `migration repair ... --status applied --local` registered only `20260823173257` in local history. No linked or remote target was used.

- [x] **Step 4: Run the failing matrix again**

Run: `node scripts/local-db/checkout-atomic-matrix.mjs`

Expected: PASS with no stock, credit, order, item, or credit-transaction residue after the deliberately invalid checkout. The same matrix also verifies a successful full-credit checkout and anonymous RPC denial.

### Task 3: Route the server action through the atomic RPC

**Files:**
- Modify: `src/app/actions/checkout.ts`
- Test: `e2e/checkout-financial.spec.ts`

**Interfaces:**
- Consumes: existing `placeOrder(items, couponCode, shippingDetails, useCredits, contactDetails)` API.
- Produces: the same `{ success, orderId, error }` result shape, with all financial writes performed by `place_order_atomic`.

- [x] **Step 1: Write the failing regression assertion**

Extend the local checkout E2E to assert that a successful order contains the database-resolved product price and that the client cannot alter the order total by changing the persisted cart item price. Add a negative local test path that submits an invalid second product through the RPC matrix and observes no stock/credit mutation.

- [x] **Step 2: Run the targeted tests**

Run the atomic matrix and the checkout E2E before changing the action. The matrix must pass once the migration exists; the E2E should continue to exercise the same UI.

- [x] **Step 3: Replace client-side financial writes**

Keep `update_profile_details` and contact validation, then call `supabase.rpc('place_order_atomic', ...)`. On RPC error return `{ success: false, error }`. On success query the own order and items for the email payload, send local SMTP email through the existing guarded helper, and return the UUID. Remove the separate service-role stock loop, credit mutation, order insert, and order-item insert from this action.

- [x] **Step 4: Run targeted tests again**

Run the helper tests, atomic matrix, and checkout E2E. Expected: all pass with exactly one stock decrement and no leaked credits.

### Task 4: Verify, document, and close the commit checkpoint

**Files:**
- Modify: `docs/crimson-crown-backlog.md`
- Create: `docs/superpowers/plans/2026-08-23-atomic-checkout-rollback.md`

- [x] **Step 1: Document the completed P0 item**

Mark rollback consistency as locally verified, while leaving provider webhook/state design explicitly pending.

- [x] **Step 2: Run the complete local gate**

Run the environment tests, full Playwright suite, local security matrix, Storage matrix, financial matrix, atomic matrix, local migration verification, and Next build using `.env.test.local` values.

- [x] **Step 3: Inspect the diff and migration**

Run `git diff --check`, inspect the SQL function and grants, confirm no service-role key or production URL is present in tracked files, and confirm `git status` shows only this lot.

- [x] **Step 4: Commit only the reviewed local-only lot**

After owner approval, commit and push only the feature branch. Do not run a linked migration, deploy, or mutate production. Report the changed files, test evidence, migration status, and remaining webhook/Storage/staging risks.
