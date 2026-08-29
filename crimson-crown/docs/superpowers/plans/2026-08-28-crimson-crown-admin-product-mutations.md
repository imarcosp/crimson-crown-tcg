# Crimson Crown Admin Product Mutations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every administrative browser write to `public.products` with validated Server Actions and authorized, atomic, idempotent Supabase RPCs that preserve inventory origin and stock audit history.

**Architecture:** Client components keep their current UI and read paths, but submit mutations to `src/app/actions/admin-products.ts`. The actions validate plain serializable inputs, require the authenticated Crimson administrator, and invoke database functions that repeat authorization, calculate `variant_key`, serialize concurrent stock updates, and write `inventory_stock_movements`. The migration is additive in this plan; direct table grants are not revoked until the separate RLS plan.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Supabase JS 2.86, PostgreSQL/PLpgSQL, Node test runner, Playwright, local Supabase CLI 2.76.16.

**Spec:** `docs/superpowers/specs/2026-08-28-crimson-crown-production-hardening-design.md`

## Global Constraints

- Work only inside `D:\crimson-crown-tcg\crimson-crown`.
- Do not stop, remove, inspect data from, or write to the El Perchero or Che Maracucho containers.
- All database mutation tests must verify the Supabase hostname is `127.0.0.1`, `localhost`, or `::1` before creating fixtures.
- Do not link, push, migrate, deploy, or write to remote Supabase or Vercel.
- Do not create or process Mercado Pago behavior. SaaS remains excluded.
- Preserve all existing orders, customers, products, inventories, stock, and history.
- Use TDD: write each behavior test, observe the expected failure, then implement the minimum change.
- Create migration files with `supabase migration new`; never invent a migration timestamp.
- Every `SECURITY DEFINER` function must check `public.is_admin()`, set `search_path = public, pg_temp`, revoke `EXECUTE` from `PUBLIC`/`anon`, and grant only required roles.
- Do not expose `SUPABASE_SERVICE_ROLE_KEY` to client components or use it in the new Server Actions.

---

### Task 1: Define and validate the product mutation contract

**Files:**

- Create: `src/lib/admin/product-mutations.ts`
- Create: `src/lib/admin/product-mutations.test.ts`

**Interfaces:**

```ts
export type AdminProductInput = {
  name: string
  set_name: string
  collector_number: string | null
  tcg: string
  price_usd: number
  stock: number
  condition: string
  finish: string
  rarity: string
  image_url: string
  scryfall_id: string | null
  is_manual_price: boolean
  language: string
  metadata: Record<string, unknown>
}

export type ProductInputResult =
  | { success: true; data: AdminProductInput }
  | { success: false; error: string }

export function parseAdminProductInput(input: unknown): ProductInputResult
```

- [x] **Step 1: Write the failing validation tests.**

Use literal fixtures and assert consumer-visible results:

```ts
test('normaliza un producto válido sin aceptar campos controlados por la base', () => {
  const result = parseAdminProductInput({
    id: 'forbidden',
    inventory_id: 'forbidden',
    variant_key: 'forbidden',
    name: '  Black   Lotus ',
    set_name: ' Limited Edition Alpha ',
    collector_number: ' 232 ',
    tcg: ' Magic ',
    price_usd: 12.5,
    stock: 3,
    condition: ' NM ',
    finish: ' Non-Foil ',
    rarity: ' Rare ',
    image_url: ' https://example.test/lotus.jpg ',
    scryfall_id: ' abc ',
    is_manual_price: true,
    language: ' English ',
    metadata: { gallery: [] },
  })
  assert.deepEqual(result, {
    success: true,
    data: {
      name: 'Black Lotus', set_name: 'Limited Edition Alpha', collector_number: '232',
      tcg: 'Magic', price_usd: 12.5, stock: 3, condition: 'NM', finish: 'Non-Foil',
      rarity: 'Rare', image_url: 'https://example.test/lotus.jpg', scryfall_id: 'abc',
      is_manual_price: true, language: 'English', metadata: { gallery: [] },
    },
  })
})

test('rechaza stock negativo o fraccionario y precios no finitos', () => {
  assert.deepEqual(parseAdminProductInput({ ...validInput, stock: -1 }), { success: false, error: 'El stock debe ser un entero no negativo.' })
  assert.deepEqual(parseAdminProductInput({ ...validInput, stock: 1.5 }), { success: false, error: 'El stock debe ser un entero no negativo.' })
  assert.deepEqual(parseAdminProductInput({ ...validInput, price_usd: Number.NaN }), { success: false, error: 'El precio debe ser un número no negativo.' })
})

test('rechaza objetos metadata no planos y prototipos peligrosos', () => {
  const polluted = Object.create({ inherited: true })
  polluted.gallery = []
  assert.deepEqual(parseAdminProductInput({ ...validInput, metadata: polluted }), { success: false, error: 'Los metadatos del producto son inválidos.' })
})
```

- [x] **Step 2: Run the focused test and observe RED.**

Run:

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --experimental-strip-types src/lib/admin/product-mutations.test.ts
```

Expected: FAIL because `product-mutations.ts` does not exist.

- [x] **Step 3: Implement minimal normalization and validation.**

Implementation rules:

```ts
const normalizeText = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ')

// Required: name, set_name, tcg, condition, finish, language.
// stock: Number.isInteger(stock) && stock >= 0.
// price_usd: Number.isFinite(price) && price >= 0.
// metadata: Object.getPrototypeOf(value) === Object.prototype or value is undefined/null.
// Return a newly constructed allowlisted object; never spread the input.
```

- [x] **Step 4: Run the focused test and observe GREEN.**

Expected: all validation tests pass with zero warnings.

- [x] **Step 5: Commit the contract.**

```powershell
git add -- crimson-crown/src/lib/admin/product-mutations.ts crimson-crown/src/lib/admin/product-mutations.test.ts
git commit -m "feat: validate admin product mutations"
```

---

### Task 2: Add atomic and idempotent local database functions

**Files:**

- Create via CLI: `supabase/migrations/*_admin_product_mutations.sql`
- Create: `scripts/local-db/admin-product-mutations-matrix.mjs`
- Modify: `package.json`

**Interfaces:**

```sql
public.admin_create_or_restock_product(
  inventory_id_input uuid,
  product_input jsonb,
  operation_key_input text
) returns table(product_id uuid, mutation_kind text, previous_stock integer, current_stock integer)

public.admin_update_product(
  product_id_input uuid,
  inventory_id_input uuid,
  product_input jsonb,
  operation_key_input text
) returns table(product_id uuid, mutation_kind text, previous_stock integer, current_stock integer)

public.admin_delete_products(
  inventory_id_input uuid,
  product_ids_input uuid[],
  operation_key_input text
) returns table(deleted_ids uuid[], rejected_ids uuid[])
```

- [x] **Step 1: Write the failing local runtime matrix.**

`scripts/local-db/admin-product-mutations-matrix.mjs` must:

```js
// 1. Load .env.test.local and abort unless hostname is loopback.
// 2. Sign in admin.local@example.test and tester.local@example.test with the synthetic local passwords.
// 3. Create a secondary inventory fixture through service_role.
// 4. Assert the standard user cannot call any admin_product RPC.
// 5. Admin creates a product with operation key A; assert stock and one inbound movement.
// 6. Repeat key A; assert stock and movement count unchanged.
// 7. Run two concurrent restocks with distinct keys B/C; assert the exact summed stock.
// 8. Create the same variant in another inventory; assert two physical product IDs.
// 9. Edit stock with key D; assert replacement and one adjustment movement with the exact delta.
// 10. Add an order-item historical reference; assert deletion returns the product ID in rejected_ids.
// 11. Delete an unreferenced zero-stock fixture; assert it appears in deleted_ids.
// 12. Clean only fixture IDs in finally and sign out.
```

All expected stock values must be literal integers derived in the test, not calculated by production helpers.

- [x] **Step 2: Run the matrix and observe RED.**

Run:

```powershell
node scripts/local-db/admin-product-mutations-matrix.mjs
```

Expected: FAIL with PostgREST function-not-found for `admin_create_or_restock_product`.

- [x] **Step 3: Generate the migration with the installed CLI.**

Run:

```powershell
.\node_modules\.bin\supabase.cmd migration new admin_product_mutations
```

Record the exact generated path in the task notes before editing it.

- [x] **Step 4: Implement shared SQL validation and the three RPCs.**

The migration must include these concrete protections:

```sql
-- Each RPC begins with:
if auth.uid() is null or not public.is_admin() then
  raise exception 'Sin permiso.' using errcode = '42501';
end if;

if operation_key_input is null or btrim(operation_key_input) !~ '^[A-Za-z0-9:_-]{8,160}$' then
  raise exception 'Clave de operación inválida.' using errcode = '22023';
end if;

-- Reject keys outside the allowlist:
if exists (
  select 1 from jsonb_object_keys(product_input) as key
  where key not in ('name','set_name','collector_number','tcg','price_usd','stock','condition','finish','rarity','image_url','scryfall_id','is_manual_price','language','metadata')
) then
  raise exception 'Campos de producto inválidos.' using errcode = '22023';
end if;
```

Creation/restock must extract the allowlisted JSON values into typed variables (`v_name`, `v_set_name`, `v_collector_number`, `v_tcg`, `v_price_usd`, `v_stock`, `v_condition`, `v_finish`, `v_rarity`, `v_image_url`, `v_scryfall_id`, `v_is_manual_price`, `v_language`, `v_metadata`) and use the existing trigger-generated `variant_key` and unique index `(inventory_id, variant_key)`:

```sql
insert into public.products (
  name, set_name, collector_number, tcg, price_usd, stock,
  condition, finish, rarity, image_url, scryfall_id,
  is_manual_price, language, metadata, restocked_at, inventory_id
)
values (
  v_name, v_set_name, v_collector_number, v_tcg, v_price_usd, v_stock,
  v_condition, v_finish, v_rarity, v_image_url, v_scryfall_id,
  v_is_manual_price, v_language, v_metadata,
  case when v_stock > 0 then now() else null end,
  inventory_id_input
)
on conflict (inventory_id, variant_key) do update
set stock = public.products.stock + excluded.stock,
    image_url = case when excluded.image_url <> '' then excluded.image_url else public.products.image_url end,
    metadata = case when excluded.metadata <> '{}'::jsonb then excluded.metadata else public.products.metadata end,
    restocked_at = case when excluded.stock > 0 then now() else public.products.restocked_at end
returning id, stock into v_product_id, v_current_stock;
```

Before changing stock, check `inventory_stock_movements.reference_key = 'admin-product:' || operation_key_input`. For a repeated key, return the referenced product and current stock without applying a second mutation. For a new non-zero delta, insert exactly one movement before return so a concurrent duplicate key causes the entire duplicate transaction to roll back.

Deletion must lock selected rows, restrict them to `inventory_id_input`, and reject any row referenced by `order_items` or `inventory_stock_movements`. It must never cascade or delete historical records.

End with explicit grants:

```sql
revoke all on function public.admin_create_or_restock_product(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.admin_create_or_restock_product(uuid, jsonb, text) to authenticated, service_role;
revoke all on function public.admin_update_product(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.admin_update_product(uuid, uuid, jsonb, text) to authenticated, service_role;
revoke all on function public.admin_delete_products(uuid, uuid[], text) from public, anon, authenticated;
grant execute on function public.admin_delete_products(uuid, uuid[], text) to authenticated, service_role;
```

- [x] **Step 5: Apply only the new migration to local Supabase.**

Discover the command before use:

```powershell
.\node_modules\.bin\supabase.cmd migration up --help
.\node_modules\.bin\supabase.cmd migration up --local
```

Confirm the output names only `admin_product_mutations` and does not mention a linked project.

- [x] **Step 6: Run the matrix and observe GREEN.**

Run `node scripts/local-db/admin-product-mutations-matrix.mjs` twice. Both runs must pass, proving fixture cleanup and idempotency.

- [x] **Step 7: Add the package command.**

Add exactly:

```json
"test:local-admin-products": "node scripts/local-db/admin-product-mutations-matrix.mjs"
```

- [x] **Step 8: Run local SQL lint and focused regression matrices.**

Run:

```powershell
.\node_modules\.bin\supabase.cmd db lint --local --schema public --level warning --fail-on error
npm run test:local-admin-products
npm run test:local-multi-inventory
```

- [x] **Step 9: Commit the database slice.**

Stage only the generated migration, matrix and `package.json`/lockfile if changed, then commit:

```powershell
git commit -m "feat: add atomic admin product RPCs"
```

---

### Task 3: Add authenticated Server Actions

**Files:**

- Create: `src/app/actions/admin-products.ts`
- Create: `src/lib/admin/product-action-core.ts`
- Create: `src/lib/admin/product-action-core.test.ts`
- Modify: `src/lib/admin/product-mutations.ts`

**Interfaces:**

```ts
export type AdminProductMutationResult =
  | { success: true; data: { product: Record<string, unknown>; mutationKind: 'inserted' | 'restocked' | 'updated'; previousStock: number; currentStock: number } }
  | { success: false; error: string }

export type SaveAdminProductInput = {
  inventoryId: string
  productId?: string | null
  operationKey: string
  product: unknown
}

export type ImportAdminProductsInput = {
  inventoryId: string
  rows: Array<{ operationKey: string; product: unknown }>
}

export type ImportAdminProductsResult =
  | { success: true; data: { inserted: number; updated: number; errors: Array<{ index: number; error: string }>; stockArrivals: Array<{ id: string; name: string }> } }
  | { success: false; error: string }

export type DeleteAdminProductsInput = {
  inventoryId: string
  productIds: string[]
  operationKey: string
}

export type DeleteAdminProductsResult =
  | { success: true; data: { deletedIds: string[]; rejectedIds: string[] } }
  | { success: false; error: string }

export async function saveAdminProduct(input: {
  inventoryId: string
  productId?: string | null
  operationKey: string
  product: unknown
}): Promise<AdminProductMutationResult>

export async function importAdminProducts(input: {
  inventoryId: string
  rows: Array<{ operationKey: string; product: unknown }>
}): Promise<{ success: true; data: { inserted: number; updated: number; errors: Array<{ index: number; error: string }>; stockArrivals: Array<{ id: string; name: string }> } } | { success: false; error: string }>

export async function deleteAdminProducts(input: {
  inventoryId: string
  productIds: string[]
  operationKey: string
}): Promise<{ success: true; data: { deletedIds: string[]; rejectedIds: string[] } } | { success: false; error: string }>
```

The testable core is isolated from the `'use server'` module so Next.js sees only asynchronous Server Action exports:

```ts
export type ProductMutationRpcRow = {
  product_id: string
  mutation_kind: 'inserted' | 'restocked' | 'updated'
  previous_stock: number
  current_stock: number
}

export type AdminProductGateway = {
  requireAdmin(): Promise<{ userId: string }>
  createOrRestock(args: { inventoryId: string; product: AdminProductInput; operationKey: string }): Promise<ProductMutationRpcRow>
  update(args: { productId: string; inventoryId: string; product: AdminProductInput; operationKey: string }): Promise<ProductMutationRpcRow>
  findProduct(productId: string, inventoryId: string): Promise<Record<string, unknown>>
  deleteMany(args: { inventoryId: string; productIds: string[]; operationKey: string }): Promise<{ deletedIds: string[]; rejectedIds: string[] }>
  notifyStockArrivals(items: Array<{ id: string; name: string }>): Promise<void>
}

export function createAdminProductActionCore(gateway: AdminProductGateway): {
  save(input: SaveAdminProductInput): Promise<AdminProductMutationResult>
  importRows(input: ImportAdminProductsInput): Promise<ImportAdminProductsResult>
  deleteMany(input: DeleteAdminProductsInput): Promise<DeleteAdminProductsResult>
}
```

- [x] **Step 1: Extract an injectable action core and write failing behavior tests.**

`admin-products.test.ts` must exercise real validation and a small fake implementing the exact Supabase boundary. Tests must assert outcomes, not source text:

```ts
test('saveAdminProduct rejects a non-admin before invoking RPC', async () => {
  let rpcCalls = 0
  const core = createAdminProductActionCore(nonAdminGateway({ onRpc: () => rpcCalls++ }))
  const result = await core.save(validRequest)
  assert.deepEqual(result, { success: false, error: 'Acceso denegado.' })
  assert.equal(rpcCalls, 0)
})

test('saveAdminProduct returns the database stock transition', async () => {
  const core = createAdminProductActionCore(adminGateway({
    rpcRow: { product_id: PRODUCT_ID, mutation_kind: 'restocked', previous_stock: 2, current_stock: 5 },
    product: { id: PRODUCT_ID, name: 'Black Lotus', stock: 5 },
  }))
  const result = await core.save(validRequest)
  assert.equal(result.success, true)
  if (result.success) assert.deepEqual(result.data, {
    product: { id: PRODUCT_ID, name: 'Black Lotus', stock: 5 },
    mutationKind: 'restocked', previousStock: 2, currentStock: 5,
  })
})
```

The fake gateway must return complete `ProductMutationRpcRow` and product objects and record only the boundary needed by the action. Do not mock React, Next.js, or Supabase internals.

- [x] **Step 2: Run focused tests and observe RED.**

Expected: FAIL because `admin-products.ts` and action core do not exist.

- [x] **Step 3: Implement the action core and `'use server'` wrappers.**

Concrete behavior:

```ts
async function requireAdminClient() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user || !isAdminEmail(user.email)) throw new Error('Acceso denegado.')
  return supabase
}

// saveAdminProduct chooses admin_update_product when productId exists,
// otherwise admin_create_or_restock_product. It passes only parsed data.
// After the RPC it selects the product by returned product_id and inventory_id.
```

Map Postgres codes `42501`, `22023`, `23505`, and `23503` to stable Spanish messages. Unknown errors return `No se pudo guardar el producto.` without serializing the input.

`importAdminProducts` must process chunks of five with `Promise.all`, preserve input indexes, and return partial row errors. It calls `processWishlistNotifications` once after all successful rows, using only stock arrivals returned by the RPC.

- [x] **Step 4: Run focused tests and observe GREEN.**

- [x] **Step 5: Run `npm run typecheck`.**

- [x] **Step 6: Commit the Server Action slice.**

```powershell
git commit -m "feat: secure admin product actions"
```

---

### Task 4: Migrate ProductForm and administrative deletion

**Files:**

- Modify: `src/components/admin/ProductForm.tsx`
- Modify: `src/app/admin/inventory/page.tsx`
- Modify: `e2e/multi-inventory.spec.ts`

**Interfaces:** Uses `saveAdminProduct` and `deleteAdminProducts` from Task 3.

- [x] **Step 1: Add failing Playwright assertions for manual mutations.**

Extend the existing local multi-inventory scenario to:

```ts
// Create a manual product through the visible ProductForm.
// Assert the row exists in the selected secondary inventory.
// Edit stock through the form and assert one adjustment movement.
// Attempt to delete a referenced fixture and assert the UI reports it as retained.
// Delete an unreferenced zero-stock fixture and assert it disappears.
```

Run only the focused test and confirm it fails because the current UI performs direct writes and does not report rejected IDs.

- [x] **Step 2: Replace ProductForm database mutations with `saveAdminProduct`.**

Keep browser reads and public product-image upload unchanged. Generate one operation key per explicit save click:

```ts
const operationKey = `form:${crypto.randomUUID()}`
const result = await saveAdminProduct({
  inventoryId,
  productId: initial?.id ?? null,
  operationKey,
  product: payload,
})
```

Remove direct `insert`/`update` and client-side duplicate-merge queries. Use `result.data.previousStock/currentStock` for the existing restock message and `onSaved(result.data.product)`.

- [x] **Step 3: Replace single and bulk delete calls.**

Use one operation key per confirmation. When `rejectedIds` is non-empty, keep them selected and show `No se eliminaron productos con historial.`. Reload after successful deletions.

- [x] **Step 4: Run focused E2E, action tests and typecheck.**

```powershell
npm run test:e2e -- e2e/multi-inventory.spec.ts
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --experimental-strip-types src/lib/admin/product-mutations.test.ts src/lib/admin/product-action-core.test.ts
npm run typecheck
```

- [x] **Step 5: Commit the manual UI migration.**

```powershell
git commit -m "refactor: route admin product edits through server"
```

---

### Task 5: Migrate CSV imports to the secure batch action

**Files:**

- Modify: `src/components/admin/CsvUploader.tsx`
- Modify: `e2e/multi-inventory.spec.ts`
- Modify: `scripts/local-db/admin-product-mutations-matrix.mjs`

**Interfaces:** Uses `importAdminProducts` from Task 3.

- [x] **Step 1: Add a failing CSV behavior test.**

Use a two-row local fixture: one valid row and one row with negative quantity. Assert that the valid row increments the selected inventory exactly once and the invalid row is reported without affecting another inventory.

- [x] **Step 2: Run the focused test and observe RED.**

- [x] **Step 3: Keep CSV parsing and enrichment in the component, then submit normalized rows once.**

Replace client queries and writes with:

```ts
const rows = parsedRows.map((row, index) => ({
  operationKey: `csv:${importRunId}:${index}`,
  product: toAdminProductInput(row),
}))
const result = await importAdminProducts({ inventoryId, rows })
```

Create `importRunId` once per user-started import. Retrying the same in-memory run reuses keys; starting a new import creates a new run ID. Map `result.data` to the existing progress, stats and log UI. Remove all direct product `insert`/`update` paths and the duplicate-key fallback.

- [x] **Step 4: Run CSV E2E twice and observe GREEN without duplicate stock.**

- [x] **Step 5: Run the local admin-product and multi-inventory matrices.**

- [x] **Step 6: Commit the CSV migration.**

```powershell
git commit -m "refactor: secure inventory CSV imports"
```

---

### Task 6: Verify the slice and update handoff documentation

**Files:**

- Modify: `docs/crimson-crown-backlog.md`
- Create: `docs/superpowers/plans/2026-08-28-crimson-crown-admin-product-mutations-verification.md`

- [x] **Step 1: Run the complete relevant local gate.**

```powershell
npm run test:local-admin-products
npm run test:local-security
npm run test:local-multi-inventory
npm run test:environment-safety
npm run test:e2e
npm run typecheck
npm run build
```

Run full `npm run lint` and record its exact remaining inherited error/warning counts; do not mix unrelated lint fixes into this slice.

- [x] **Step 2: Run local database lint.**

```powershell
.\node_modules\.bin\supabase.cmd db lint --local --schema public --level warning --fail-on error
```

- [x] **Step 3: Inspect the final diff for isolation and secrets.**

```powershell
git status --short
git diff --check
git diff --name-only origin/main...HEAD
git grep -n "SUPABASE_SERVICE_ROLE_KEY" -- crimson-crown/src
git grep -n "djfqozfaqkqdoqeoqbzt" -- crimson-crown/src crimson-crown/scripts crimson-crown/e2e
```

Expected: only Crimson Crown files; no secret values, dumps, production URLs in tests, or modifications to sibling projects.

- [x] **Step 4: Document evidence and remaining production gate.**

The verification note must list command, exit code, test count, migration filename and local-only status. Update the backlog to mark only subproject 1 complete; keep RLS, Storage, staging and quality open.

- [x] **Step 5: Commit the verification checkpoint.**

```powershell
git commit -m "docs: verify secure admin product mutations"
```

- [x] **Step 6: Stop before production.**

Report changed behavior, manual test checklist, the additive migration name and rollback considerations. Do not push, deploy, link Supabase, or apply the migration remotely. Wait for the owner's manual review before any production action.
