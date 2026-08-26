# Crimson Crown TypeScript Release Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make strict TypeScript validation a real release gate without weakening the compiler or changing runtime authorization behavior.

**Architecture:** Fix the existing Supabase query result shapes and callback types at their boundaries, then correct the component data contracts that TypeScript currently exposes. Once `tsc --noEmit` is green, remove Next.js's `ignoreBuildErrors` escape hatch and keep the typecheck command explicit in `package.json`.

**Tech Stack:** TypeScript strict mode, Next.js 16, Supabase typed clients, React 19, Node test runner.

**Spec:** `docs/crimson-crown-backlog.md`

## Global Constraints

- Only Crimson Crown files may change; El Perchero and Che Maracucho are out of scope.
- Do not weaken `strict`, add broad `@ts-ignore`/`@ts-nocheck`, or change Supabase authorization semantics.
- Keep SQL, production variables, deployments, and remote databases untouched.
- Run `tsc --noEmit` after every task group and run the existing security/E2E gates before the final commit.

---

### Task 1: Make the typecheck and build contracts explicit

**Files:**
- Create: `scripts/typecheck-contract.test.mjs`
- Modify: `package.json`
- Modify: `next.config.mjs`

**Interfaces:**
- `npm run typecheck` invokes `tsc --noEmit`.
- Next.js build no longer sets `typescript.ignoreBuildErrors`.

- [x] **Step 1: Write the failing contract test**

Read `package.json` and `next.config.mjs`; assert the package has a `typecheck` script and that `ignoreBuildErrors` is absent or `false`. Run the test and verify it fails against the current configuration.

- [x] **Step 2: Add the explicit typecheck script and remove the escape hatch**

Set `"typecheck": "tsc --noEmit"` and delete `typescript.ignoreBuildErrors` from `next.config.mjs`. Keep all other build and image settings unchanged.

- [x] **Step 3: Run the contract and compiler**

Run the contract test and the direct compiler command. The contract must pass; `tsc` should still list only the known source errors until Tasks 2–4 are complete.

---

### Task 2: Type Supabase action and realtime boundaries

**Files:**
- Modify: `src/app/actions/imports.ts`
- Modify: `src/app/actions/wishlist.ts`
- Modify: `src/proxy.ts`
- Modify: `src/context/AuthContext.tsx`
- Modify: `src/components/layout/NotificationsMenu.tsx`

**Interfaces:**
- Relation queries normalize `profiles` to a single optional object before reading `email`/`first_name`.
- Supabase callbacks use `AuthChangeEvent`, `Session`, `RealtimePostgresInsertPayload`, and `unknown` error narrowing where required.
- The proxy analytics insert remains best-effort and non-blocking.

- [x] **Step 1: Run `tsc --noEmit` and capture the boundary failures**

Confirm the errors for `order_number`, relation arrays, untyped Auth/Realtime callbacks, and the unsupported `.catch` call on the Postgrest builder.

- [x] **Step 2: Correct the minimal type boundaries**

Select `order_number` wherever it is read, narrow relation results with an explicit local type, annotate callback parameters from the installed Supabase types, and replace the builder `.catch` with an awaited result/error branch that preserves the existing best-effort behavior.

- [x] **Step 3: Run focused typecheck and existing contract tests**

Run `tsc --noEmit`, `node --test scripts/local-db/checkout-action-contract.test.mjs scripts/local-db/release-stock-route-contract.test.mjs`, and the Auth/environment tests. No runtime behavior should change.

---

### Task 3: Type admin, sales, catalog, and checkout data contracts

**Files:**
- Modify: `src/app/admin/fix-prices/page.tsx`
- Modify: `src/app/admin/imports/[id]/page.tsx`
- Modify: `src/app/admin/imports/page.tsx`
- Modify: `src/app/admin/orders/page.tsx`
- Modify: `src/app/admin/page.tsx`
- Modify: `src/app/admin/prices/page.tsx`
- Modify: `src/app/buylist/page.tsx`
- Modify: `src/app/sell/import/page.tsx`
- Modify: `src/components/admin/ProductForm.tsx`
- Modify: `src/components/catalog/PriceHistory.tsx`
- Modify: `src/components/catalog/ProductCard.tsx`
- Modify: `src/components/catalog/ProductDetailView.tsx`
- Modify: `src/components/checkout/MercadoPagoWallet.tsx`
- Modify: `src/components/forms/HangOrderModal.tsx`

**Interfaces:**
- Array callbacks have concrete element types inferred from the query or declared at the boundary.
- Sell/buylist payloads use the existing `SellItem` and `QuoteItem` property names (`setName`, `price`, `quantity`, and optional price fields) without changing serialized values.
- Product form objects have one property per key; Mercado Pago customization uses only keys supported by the installed SDK types.

- [x] **Step 1: Fix query callback and state setter annotations**

Annotate only the callback parameters reported by TypeScript and narrow optional values before calling setters. Do not use `any` as a shortcut.

- [x] **Step 2: Fix data model mismatches and duplicate object keys**

Map `isFoil` to the field already expected by the sell item contract, use `setName` consistently, supply `price`/`quantity` when constructing `QuoteItem`, and remove duplicate ProductForm keys while preserving the final submitted values.

- [x] **Step 3: Fix third-party component types**

Use the Mercado Pago SDK's accepted `redirectMode` and customization keys, and accept `number | undefined` in the Recharts formatter before formatting.

- [x] **Step 4: Run `tsc --noEmit` and the catalog/checkout tests**

The remaining compiler errors must be limited to Task 4 files, with no new errors in the edited groups.

---

### Task 4: Type email and shared UI components, then enable the gate

**Files:**
- Modify: `src/components/emails/OrderTemplate.tsx`
- Modify: `src/components/layout/ActiveImportsBanner.tsx`
- Modify: `src/components/layout/Navbar.tsx`
- Modify: `src/lib/buylist-quote-pdf.ts`
- Modify: `src/lib/howToContent.ts`
- Modify: `src/lib/moxfield.ts`
- Modify: `src/lib/supabase/client.ts`
- Modify: `src/lib/utils.ts`
- Modify: `src/store/cartStore.ts`

**Interfaces:**
- Shared components use existing domain types and `unknown` narrowing; no runtime API changes.
- `OrderTemplate` imports the existing `siteConfig` value instead of relying on an undeclared global.

- [x] **Step 1: Fix missing imports and callback/domain types**

Resolve the reported `siteConfig`, formatter, Realtime payload, event/session, and utility type errors with the narrowest existing types.

- [x] **Step 2: Run the complete typecheck**

Run `npm run typecheck` through the bundled Node/npm runtime. Expected result: zero TypeScript errors.

- [x] **Step 3: Run the build with type validation enabled**

Run the local build with `.env.test.local`; the output must no longer say `Skipping validation of types` and must finish successfully.

- [x] **Step 4: Run the complete local verification suite**

Run the environment-safety suite, SQL lint, security/financial/atomic matrices, and Playwright E2E against loopback. Record any pre-existing ESLint warnings separately; do not mix lint cleanup into this plan.

- [x] **Step 5: Update backlog and create a checkpoint commit**

Record the green typecheck gate and leave Storage audit, payment/webhook design, and production owner review as blockers. Commit only this plan's files and the TypeScript/config changes; do not push or deploy.
