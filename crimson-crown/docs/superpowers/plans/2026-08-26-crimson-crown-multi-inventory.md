# Crimson Crown Multi-Inventory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement independent inventories, hybrid catalog aggregation, primary-first checkout allocation, source-aware order operations, per-inventory metrics, and local Playwright coverage for Crimson Crown.

**Architecture:** Keep one `products` table and attach every product to an `inventories` row. Use a deterministic `variant_key` to aggregate equivalent offers for public catalog reads while retaining separate physical rows. Move checkout, cancellation, expiry, refund restock, and partial item removal into locked/idempotent database functions that persist the source inventory on each order line.

**Tech Stack:** Next.js 16 App Router, React 19, Supabase Postgres/RLS/RPC, TypeScript, Zustand, Tailwind, Node test runner, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-26-crimson-crown-multi-inventory-design.md`

## Global Constraints

- Work only inside `D:\crimson-crown-tcg\crimson-crown`.
- The current products become the protected Inventario Principal.
- Secondary inventories never merge physically with another inventory.
- Catalog reads include only active inventories with available stock.
- Checkout consumes the primary inventory before active secondary inventories.
- Every new order line stores the physical product and source inventory.
- Card Kingdom is the automatic price source and TCGplayer is the automatic fallback.
- Manual prices remain independent and are never overwritten by price sync.
- Historical inventories are archived rather than physically deleted.
- No write, migration, deploy, variable change, or test may target Vercel or remote Supabase.
- New public-schema tables/functions must have explicit grants and RLS policies.
- Database functions must validate authorization and use a fixed `search_path`.

---

### Task 1: Add pure inventory identity and allocation domain helpers

**Files:**
- Create: `src/lib/inventory/domain.ts`
- Create: `src/lib/inventory/domain.test.ts`

**Interfaces:**
- `VariantIdentity`: `{ tcg?: unknown; scryfallId?: unknown; name?: unknown; setName?: unknown; collectorNumber?: unknown; condition?: unknown; language?: unknown; finish?: unknown }`.
- `buildVariantKey(input: VariantIdentity): string` returns a deterministic lower-case key. Magic rows use `scryfallId` plus condition/language/finish; rows without it use TCG/name/set/collector plus condition/language/finish.
- `InventoryOffer`: `{ productId: string; inventoryId: string; inventoryKind: 'primary' | 'secondary'; variantKey: string; stock: number; priceUsd: number; pricingSource: 'cardkingdom' | 'tcgplayer' | 'manual' | 'unknown' }`.
- `allocateOffers(offers: InventoryOffer[], requestedQuantity: number)` returns `{ allocations: Array<{ offer: InventoryOffer; quantity: number }>; remaining: number }` and orders primary before secondary, then inventory ID, then product ID.
- `groupOffers(offers: InventoryOffer[])` returns catalog groups with total stock and distinct pricing offers without merging physical product IDs.

- [ ] **Step 1: Write failing tests for exact variant identity.**

  Cover same Magic print with different inventory producing the same key, a different finish producing a different key, and non-Magic products using normalized name/set/collector fields.

- [ ] **Step 2: Run the focused test and verify the expected failure.**

  Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --experimental-strip-types src/lib/inventory/domain.test.ts`

  Expected: FAIL because `src/lib/inventory/domain.ts` does not yet export the domain functions.

- [ ] **Step 3: Implement the minimal normalization, key, allocation, and grouping helpers.**

  Normalize nullish values to empty strings, collapse whitespace, lower-case the comparison fields, and never include price, stock, image, inventory ID, or dates in the variant key. Reject non-positive or fractional requested quantities by returning no allocations and the original remaining quantity.

- [ ] **Step 4: Add allocation and grouping edge-case tests.**

  Cover partial primary allocation, secondary fallback, inactive offers excluded by the caller, exact tie ordering, insufficient stock, same-price automatic grouping, and distinct manual prices remaining as separate offers.

- [ ] **Step 5: Run the focused test and refactor only after green.**

  Run the same command. Expected: PASS with no test errors.

- [ ] **Step 6: Commit the domain helper.**

  Commit message: `feat: add multi-inventory domain helpers`.

### Task 2: Create the local database foundation and backfill the primary inventory

**Files:**
- Modify: `supabase/migrations/20260827020755_create_multi_inventory_system.sql`
- Modify: `src/types/database.ts`
- Create: `scripts/local-db/multi-inventory-migration-contract.test.mjs`

**Interfaces:**
- SQL tables: `public.inventories`, `public.inventory_stock_movements`.
- Product columns: `products.inventory_id uuid not null`, `products.variant_key text not null`.
- Order item columns: `order_items.inventory_id uuid not null`, `order_items.variant_key text`, `order_items.source_inventory_name text`.
- SQL function: `public.build_product_variant_key(...) returns text`.
- SQL functions: `public.create_inventory`, `public.set_inventory_active`, `public.archive_inventory`, `public.delete_inventory_safely`.

- [ ] **Step 1: Verify the generated migration through the local Supabase CLI.**

  The local CLI is version `2.76.16` and has already generated `supabase/migrations/20260827020755_create_multi_inventory_system.sql`. Reconfirm the version with `.\\node_modules\\.bin\\supabase.cmd --version`; do not invent another timestamp or modify migration history manually.

- [ ] **Step 2: Write a migration contract test before the SQL implementation.**

  Assert that the migration contains the protected-primary constraint, non-null product/order origins, variant index, stock movement idempotency key, explicit grants/revokes, admin checks, and safe-delete checks.

- [ ] **Step 3: Run the contract test and verify it fails for the missing migration contents.**

  Run: `node --test scripts/local-db/multi-inventory-migration-contract.test.mjs`

  Expected: FAIL because the generated migration does not yet contain the required statements.

- [ ] **Step 4: Implement the foundation migration.**

  Create the tables with UUID primary keys, timestamps, optional location label, `kind` check, active/archive fields, and foreign keys. Insert one deterministic primary inventory if none exists, backfill every existing product to it, calculate every product `variant_key`, backfill existing order items to the primary and snapshot its name, then enforce non-null constraints. Add indexes for `(inventory_id, variant_key)`, active catalog reads, order-origin reads, and movement references.

- [ ] **Step 5: Add RLS and function permissions.**

  Enable RLS on both new tables. Allow public catalog reads only through active product rows already exposed by the existing products policy; allow authenticated admins to manage inventories and movements. Revoke public execute on admin and stock functions, then grant only `authenticated` and `service_role` where required. Every security-definer function must check `public.is_admin()` or authenticated ownership and set `search_path = public, pg_temp`.

- [ ] **Step 6: Implement safe inventory lifecycle functions.**

  `set_inventory_active` must reject the primary. `archive_inventory` must reject the primary and retain rows. `delete_inventory_safely` must lock the inventory, reject the primary, reject any stock, active orders, order items, movement rows, or historical references, and only then delete associated products and the inventory row.

- [ ] **Step 7: Update the database type contract.**

  Extend `DatabaseProduct` with `inventory_id`, `variant_key`, `is_manual_price`, and optional inventory metadata used by the UI. Add exported `Inventory`, `InventoryOffer`, and `InventoryMetric` interfaces without weakening existing types.

- [ ] **Step 8: Run the migration contract test and static checks.**

  Run: `node --test scripts/local-db/multi-inventory-migration-contract.test.mjs` and `npm run typecheck`.

  Expected: PASS for the contract and no new TypeScript errors.

- [ ] **Step 9: Commit the local migration foundation.**

  Commit message: `feat: add independent inventory database foundation`.

### Task 3: Implement server-side inventory lifecycle actions and admin management UI

**Files:**
- Create: `src/app/actions/admin-inventories.ts`
- Create: `src/app/admin/inventories/page.tsx`
- Create: `src/components/admin/InventorySelector.tsx`
- Create: `src/components/admin/InventoryStatusBadge.tsx`
- Modify: `src/components/admin/AdminNav.tsx`
- Modify: `src/app/admin/page.tsx`
- Modify: `src/app/admin/layout.tsx`
- Create: `src/app/actions/admin-inventories.test.ts`

**Interfaces:**
- `getAdminInventories(): Promise<{ success: true; inventories: Inventory[] } | { success: false; error: string }>`.
- `createAdminInventory(input: { name: string; description?: string; locationLabel?: string }): Promise<ActionResult<Inventory>>`.
- `setAdminInventoryActive(id: string, active: boolean): Promise<ActionResult>`.
- `archiveAdminInventory(id: string): Promise<ActionResult>`.
- `deleteAdminInventory(id: string): Promise<ActionResult<{ deletedProducts: number }>>`.

- [ ] **Step 1: Write failing action contract tests.**

  Read the action source as a string and assert it requires an authenticated admin, calls the inventory RPCs instead of direct privileged table writes, validates non-empty names, and never exposes `SUPABASE_SERVICE_ROLE_KEY` to client components.

- [ ] **Step 2: Run the action contract test and verify the expected failure.**

  Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --experimental-strip-types src/app/actions/admin-inventories.test.ts`

- [ ] **Step 3: Implement the server actions.**

  Use the existing server Supabase client and a shared error formatter. Return Spanish user-facing messages for duplicate names, primary protection, historical references, and inactive deletion. Never accept `kind`, `isPrimary`, or inventory ownership from the browser.

- [ ] **Step 4: Build the inventory management page.**

  Add summary cards and a responsive table/grid with type, state, units, variants, valuation, sales, location, and actions. The primary card has no deactivate/archive/delete controls. Secondary lifecycle changes require a confirmation dialog and reload the server state after success.

- [ ] **Step 5: Add the shared selector and navigation entry.**

  Persist the selected inventory ID in the URL query string where possible. Default to the primary inventory. Keep the existing admin PIN/auth guard intact and do not add a second authorization mechanism.

- [ ] **Step 6: Run tests and typecheck.**

  Run the focused action test and `npm run typecheck`. Expected: PASS.

- [ ] **Step 7: Commit the admin inventory management slice.**

  Commit message: `feat: add admin inventory lifecycle management`.

### Task 4: Scope product forms, CSV imports, and price synchronization to an inventory

**Files:**
- Modify: `src/app/admin/inventory/page.tsx`
- Modify: `src/components/admin/ProductForm.tsx`
- Modify: `src/components/admin/CsvUploader.tsx`
- Modify: `scripts/update-prices.mjs`
- Modify: `scripts/update-prices-batch.mjs`
- Modify: `scripts/update-riftbound-prices.mjs`
- Create: `src/lib/inventory/product-scope.test.ts`

**Interfaces:**
- Product form receives `inventoryId: string` and includes it in all reads, updates, duplicate checks, and inserts.
- CSV uploader receives `inventoryId: string` and includes it in every lookup, upsert, insert, stock arrival, and wishlist notification payload.
- Price scripts update all automatic products across inventories while skipping `is_manual_price = true` rows.

- [ ] **Step 1: Write failing scope tests.**

  Assert that the product-form and CSV source code includes inventory-scoped duplicate queries, never performs a global same-variant merge, and sends `inventory_id` to the upsert path. Assert price scripts filter manual rows out and do not collapse rows across inventory IDs.

- [ ] **Step 2: Run the scope tests and verify the expected failure.**

  Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --experimental-strip-types src/lib/inventory/product-scope.test.ts`

- [ ] **Step 3: Add inventory context to the admin inventory page.**

  Load the selected inventory, pass it to `ProductForm` and `CsvUploader`, filter all stats and rows by `inventory_id`, and keep the existing primary inventory as the default when no query parameter exists.

- [ ] **Step 4: Update manual product creation and editing.**

  Preserve the current Card Kingdom/TCGplayer finish resolution. Scope all duplicate checks and `upsert_product_variant` calls by inventory. Generate `variant_key` through the server/database contract and keep manual prices untouched.

- [ ] **Step 5: Update CSV import paths.**

  Scope existing-row lookups and stock updates to the selected inventory. Ensure a CSV row matching a product in another inventory creates or updates only the selected inventory row. Keep wishlist notifications tied to the newly restocked product ID.

- [ ] **Step 6: Update price sync scripts.**

  Include `inventory_id` in selected fields and filters where needed, update automatic rows in every inventory, and explicitly skip manual prices. Do not add any remote execution to the scripts.

- [ ] **Step 7: Run focused tests and typecheck.**

  Expected: PASS with no new TypeScript errors.

- [ ] **Step 8: Commit the inventory-scoped product loading slice.**

  Commit message: `feat: scope product loading by inventory`.

### Task 5: Add the hybrid catalog query and update customer-facing presentation

**Files:**
- Create: `src/lib/inventory/catalog.ts`
- Create: `src/lib/inventory/catalog.test.ts`
- Modify: `src/app/catalog/page.tsx`
- Modify: `src/app/api/search/route.ts`
- Modify: `src/components/catalog/ProductCard.tsx`
- Modify: `src/components/catalog/ProductDetailView.tsx`
- Modify: `src/components/catalog/QuantitySelector.tsx`

**Interfaces:**
- `CatalogGroup`: `{ variantKey: string; representative: DatabaseProduct; totalStock: number; offers: CatalogOffer[] }`.
- `CatalogOffer`: `{ pricingSource: 'cardkingdom' | 'tcgplayer' | 'manual' | 'unknown'; priceUsd: number; stock: number; inventoryCount: number }`.
- `getCatalogGroups(products: DatabaseProduct[]): CatalogGroup[]` groups only equal variant keys and excludes inactive inventory rows before grouping.

- [ ] **Step 1: Write failing catalog tests.**

  Cover two equivalent rows summing stock, a different condition remaining separate, same-price automatic offers collapsing, and manual prices remaining visibly distinct.

- [ ] **Step 2: Run the focused catalog test and verify failure.**

  Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --experimental-strip-types src/lib/inventory/catalog.test.ts`

- [ ] **Step 3: Implement server-side catalog grouping.**

  Use an explicit select list, filter active inventory rows and positive stock, derive effective pricing source from the existing product/external-price data, and map the representative image/metadata without losing the offer breakdown.

- [ ] **Step 4: Update catalog and search routes.**

  Keep existing category, finish, rarity, color, and pagination behavior. Ensure search results pass through the same grouping rule so a search cannot expose duplicate cards from different inventories.

- [ ] **Step 5: Update card and detail views.**

  Show total availability. When offers differ, show separate chips/rows for automatic, fallback, and manual prices. Do not expose internal inventory names in the public catalog unless the current page already requires a source label.

- [ ] **Step 6: Run tests, typecheck, and a local catalog smoke check.**

  Run the focused test and `npm run typecheck`. Expected: PASS.

- [ ] **Step 7: Commit the hybrid catalog slice.**

  Commit message: `feat: aggregate active inventories in catalog`.

### Task 6: Make the cart and checkout allocate hybrid variants atomically

**Files:**
- Modify: `src/store/cartStore.ts`
- Modify: `src/store/cart-hydration.ts`
- Modify: `src/components/cart/CartSync.tsx`
- Modify: `src/app/actions/checkout.ts`
- Modify: `supabase/migrations/20260827020755_create_multi_inventory_system.sql`
- Create: `src/lib/inventory/checkout-contract.test.ts`
- Modify: `scripts/local-db/checkout-action-contract.test.mjs`

**Interfaces:**
- Cart items persist `variantKey`, `displayOffers`, and quantity while accepting legacy `id` values during migration.
- SQL function: `public.place_order_hybrid_atomic(p_items jsonb, ...existing checkout arguments...) returns uuid`.
- Input item shape: `{ variant_key: string; quantity: integer }`.
- New order rows contain the physical `product_id`, `inventory_id`, `variant_key`, `source_inventory_name`, quantity, and resolved price.

- [ ] **Step 1: Write failing checkout contract tests.**

  Assert the action calls `place_order_hybrid_atomic`, never trusts client prices, and does not call direct product stock updates. Add a pure test that a request for three units allocates one primary and two secondary units in that order.

- [ ] **Step 2: Run the checkout tests and verify failure.**

  Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --experimental-strip-types src/lib/inventory/checkout-contract.test.ts scripts/local-db/checkout-action-contract.test.mjs`

  Expected: FAIL because the action and RPC still use the old product-ID-only contract.

- [ ] **Step 3: Implement the hybrid checkout SQL function.**

  Validate the authenticated user and input array. For each variant, lock all matching active inventory rows with positive stock in deterministic order, allocate primary first, compute each line price from the locked row, apply coupons/credits using the resolved subtotal, insert one order item per source row, and insert one movement per reservation/sale. Roll back everything on insufficient stock or invalid input.

- [ ] **Step 4: Add idempotent order-source fields and backfill behavior.**

  Existing orders remain assigned to the primary. New rows require `inventory_id` and `source_inventory_name`; the function rejects any allocation that cannot resolve an active source.

- [ ] **Step 5: Update cart persistence and checkout action.**

  Preserve legacy cart hydration. Resolve old product IDs to their `variant_key`, send only variant/quantity to the server, and display a server-resolved breakdown when the order response is available.

- [ ] **Step 6: Run focused contract tests and typecheck.**

  Expected: PASS.

- [ ] **Step 7: Commit the atomic hybrid checkout slice.**

  Commit message: `feat: allocate hybrid checkout by inventory`.

### Task 7: Make cancellation, expiry, refund restock, and partial deletion source-aware

**Files:**
- Modify: `supabase/migrations/20260827020755_create_multi_inventory_system.sql`
- Modify: `src/app/actions/admin-orders.ts`
- Modify: `src/app/api/cron/release-stock/route.ts`
- Modify: `src/app/admin/orders/[id]/page.tsx`
- Create: `src/lib/inventory/order-operations.test.ts`
- Modify: `scripts/local-db/release-stock-route-contract.test.mjs`
- Modify: `scripts/local-db/checkout-atomic-matrix.mjs`
- Modify: `scripts/local-db/release-stock-atomic-matrix.mjs`

**Interfaces:**
- SQL function: `public.cancel_order_atomic(order_id_input uuid, restock boolean, refund_credits boolean) returns void`.
- SQL function: `public.refund_order_atomic(order_id_input uuid, restock boolean, credit_amount numeric) returns void`.
- SQL function: `public.remove_order_item_atomic(order_item_id_input uuid, quantity_to_remove integer, restock boolean) returns void`.
- Existing expiry RPC is updated to use `order_items.inventory_id` and movement idempotency.

- [ ] **Step 1: Write failing order-operation tests.**

  Cover source restoration to the original inventory, no duplicate restoration on repeated operation, partial quantity removal, and rejection for terminal orders or quantities outside the line balance.

- [ ] **Step 2: Run the focused tests and verify failure.**

  Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --experimental-strip-types src/lib/inventory/order-operations.test.ts scripts/local-db/release-stock-route-contract.test.mjs`

- [ ] **Step 3: Implement atomic SQL operations.**

  Lock the order and affected lines, check allowed states, insert a unique compensating movement, increment the exact `products` row identified by `product_id` and `inventory_id`, update line quantity or mark it removed, and update order state in the same transaction. Credit operations remain inside the corresponding server-side transaction.

- [ ] **Step 4: Route all admin cancellation/refund actions through the RPCs.**

  Remove direct `restore_stock`, direct order status updates for cancellation/refund, and separate credit writes from the order operation. Preserve existing UI options for restock and credit refund while making the action atomic.

- [ ] **Step 5: Update expiry cron delegation.**

  Keep the route as a thin authenticated/secret-guarded caller of the atomic expiry RPC. Ensure no route code reads `order_items` or updates `products` directly.

- [ ] **Step 6: Add partial line removal controls to the admin order detail.**

  Show available removable quantity, require confirmation, call the RPC, and refresh the order. Do not allow removal for cancelled/refunded/completed states unless the server permits a specific restock workflow.

- [ ] **Step 7: Run local financial matrices and typecheck.**

  Run: `npm run test:local-atomic-checkout`, `npm run test:local-release-stock`, `npm run test:checkout-contract`, and `npm run typecheck`. Expected: PASS.

- [ ] **Step 8: Commit source-aware order operations.**

  Commit message: `feat: restore stock by order source inventory`.

### Task 8: Add per-inventory metrics and source visibility in order details

**Files:**
- Create: `src/app/actions/admin-inventory-metrics.ts`
- Create: `src/components/admin/InventoryMetricsPanel.tsx`
- Modify: `src/app/admin/inventories/page.tsx`
- Modify: `src/app/admin/page.tsx`
- Modify: `src/app/admin/orders/[id]/page.tsx`
- Create: `src/lib/inventory/metrics.ts`
- Create: `src/lib/inventory/metrics.test.ts`

**Interfaces:**
- `getAdminInventoryMetrics(inventoryId: string, range: { from: string; to: string }): Promise<ActionResult<InventoryMetric>>`.
- `InventoryMetric`: `{ stockUnits; variantCount; stockValuationUsd; unitsSold; grossSalesUsd; netSalesUsd; cancellations; refunds; averageLineValueUsd; inboundUnits; adjustmentUnits }`.
- Order line presentation includes `sourceInventoryName`, `inventoryLocationLabel`, and a principal/secondary style token.

- [ ] **Step 1: Write failing metric tests.**

  Cover independent aggregation, proportional allocation of order-level discount/credits, cancellation exclusion from net sales, and stock valuation using current row price.

- [ ] **Step 2: Run the metric tests and verify failure.**

  Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --experimental-strip-types src/lib/inventory/metrics.test.ts`

- [ ] **Step 3: Implement metric aggregation.**

  Aggregate order lines by `inventory_id`, include only accepted order states, allocate discount/credits by line gross value with a cent correction on the last line, and use movement types for inbound/adjustment/cancellation counts.

- [ ] **Step 4: Add inventory metrics UI.**

  Add range filters and compact metric cards to the inventory detail view. Keep the existing global dashboard totals unchanged while adding a per-inventory breakdown/link.

- [ ] **Step 5: Add source badges to `/admin/orders/[id]`.**

  Extend the select to include inventory fields. Render `Sale de: <inventory name>` on every line, optionally followed by `· <location>`. Keep legacy orders labeled `Inventario Principal (orden histórica)`. If the same card has multiple source lines, keep them separate.

- [ ] **Step 6: Run focused tests and typecheck.**

  Expected: PASS.

- [ ] **Step 7: Commit metrics and order source visibility.**

  Commit message: `feat: add inventory metrics and order source badges`.

### Task 9: Add local database fixtures, authorization coverage, and Playwright E2E flows

**Files:**
- Modify: `scripts/local-db/financial-matrix.mjs`
- Modify: `scripts/local-db/security-matrix.mjs`
- Create: `scripts/local-db/multi-inventory-atomic-matrix.mjs`
- Create: `scripts/local-db/multi-inventory-security.test.mjs`
- Create: `e2e/multi-inventory.spec.ts`
- Modify: `playwright.config.ts`
- Modify: `package.json`

**Interfaces:**
- Local fixture names: `Inventario Principal`, `Inventario Secundario E2E`, `E2E_VARIANT_PRIMARY`, `E2E_VARIANT_SECONDARY`.
- E2E path: admin creates secondary inventory → adds same variant in both inventories → catalog shows aggregate → checkout consumes primary then secondary → admin order detail shows both source badges → cancellation restores both rows → metrics separate values.

- [ ] **Step 1: Write failing local matrix assertions.**

  Add assertions for cross-inventory non-merge, primary-first allocation, exact restoration, inactive inventory exclusion, safe delete/archive, and admin-only lifecycle operations.

- [ ] **Step 2: Run the new matrix before implementation and verify failure.**

  Run: `node scripts/local-db/multi-inventory-atomic-matrix.mjs` and `node --test scripts/local-db/multi-inventory-security.test.mjs`.

- [ ] **Step 3: Implement deterministic local fixtures and matrix operations.**

  Use only the local Supabase URL/ports from the existing environment guard. Create and clean synthetic rows inside a transaction or with explicit fixture IDs. Never read or print production credentials or data.

- [ ] **Step 4: Write Playwright E2E tests.**

  Cover admin navigation to Inventarios, creation/activation, inventory-scoped product creation, public aggregate stock, source labels in the admin order detail, cancellation restoration, and metrics cards. Use existing synthetic local accounts and fixture cleanup patterns.

- [ ] **Step 5: Run the E2E test in local-only mode and inspect artifacts.**

  Run: `npm run test:e2e -- e2e/multi-inventory.spec.ts`.

  Expected: all new scenarios PASS, with no test connecting to a non-loopback URL.

- [ ] **Step 6: Add the focused E2E command to the package scripts if useful.**

  Keep the existing full `test:e2e` command intact and add `test:e2e:inventory` only if it improves repeatability without changing environment guards.

- [ ] **Step 7: Commit local matrix and E2E coverage.**

  Commit message: `test: cover multi-inventory workflows locally`.

### Task 10: Full verification, manual review build, and production-readiness handoff

**Files:**
- Modify: `docs/crimson-crown-backlog.md`
- Create: `docs/superpowers/plans/2026-08-26-crimson-crown-multi-inventory-verification.md` only if additional handoff notes are needed.

- [ ] **Step 1: Run the complete local verification set.**

  Run all of the following from the Crimson Crown repository:

  ```text
  npm run typecheck
  npm run lint
  npm run test:environment-safety
  npm run test:local-security
  npm run test:local-financial
  npm run test:local-atomic-checkout
  npm run test:local-release-stock
  npm run test:local-storage
  npm run test:e2e
  npm run build
  ```

- [ ] **Step 2: Start the local server and verify it in a browser.**

  Start only the local Next server on the approved loopback port. Use the browser verification flow to check the home page, `/admin/inventories`, `/admin/inventory`, and `/admin/orders/<fixture-id>`, capture console errors, and close the browser after inspection.

- [ ] **Step 3: Review the final diff for project isolation.**

  Confirm `git status` contains only Crimson Crown changes, no `.env`/credential/dump files, no remote URLs added to tests, no Vercel/Supabase remote commands, and no unrelated project paths.

- [ ] **Step 4: Update the Crimson Crown backlog with local verification evidence.**

  Record the implemented feature, local-only status, test commands and any known blocker. Do not mark production-ready until the owner manually tests the local build and authorizes a separate remote migration review.

- [ ] **Step 5: Give the handoff without push or deploy.**

  Report the local URL, test evidence, changed files, remaining production migration gates, and the exact point at which owner approval is required. Explicitly state that no Vercel or remote Supabase changes were made.
