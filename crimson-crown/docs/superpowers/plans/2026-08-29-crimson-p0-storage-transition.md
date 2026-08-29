# Crimson Crown P0 Storage Transition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove general browser writes from Storage and move payment proofs to owner/admin-only signed reads without breaking existing catalog images or historical proof URLs.

**Architecture:** Pure policy code validates upload intent and builds canonical paths. Authenticated Server Actions issue Supabase signed-upload tokens for one exact path; the browser uploads with that token, then server finalization verifies stored metadata and file signature before changing business state. New nullable path columns coexist with legacy URL columns until a verified backfill allows the proof bucket to become private.

**Tech Stack:** Next.js 16 Server Actions, TypeScript, Supabase JS 2.86, Supabase Storage, PostgreSQL 17, Node 24/`node:test`, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-29-crimson-crown-emergency-hardening-design.md`

**Supabase references:** [signed upload URL](https://supabase.com/docs/reference/javascript/file-buckets-createsigneduploadurl), [upload to signed URL](https://supabase.com/docs/reference/javascript/file-buckets-uploadtosignedurl), [bucket restrictions](https://supabase.com/docs/guides/storage/buckets/creating-buckets), [private bucket access](https://supabase.com/docs/guides/storage/buckets/fundamentals).

## Global Constraints

- `products` and `banners` remain public for reads; `payment_proofs` becomes private only at the final phase.
- Maximum upload size is 5 MiB. Product/banner MIME: JPEG, PNG, WebP. Proof MIME additionally permits PDF.
- A signed upload URL is valid for two hours, so it must authorize one UUID path and `upsert: false` only.
- `service_role` stays in server-only modules and never appears in client props, responses or `NEXT_PUBLIC_*` variables.
- Existing `payment_proof_url`/`proof_url` values and Storage objects are preserved.
- No migration, policy or bucket change is applied to production in this plan.
- Direct `.storage.from(...).upload(...)` calls are forbidden outside the single signed-upload client helper.

---

## File map

- Create `src/lib/storage/upload-policy.ts` and `.test.ts`: kinds, MIME/extension/size rules and canonical path construction.
- Create `src/lib/storage/upload-core.ts` and `.test.ts`: dependency-injected ticket authorization/finalization.
- Create `src/lib/storage/file-signatures.ts` and `.test.ts`: PNG/JPEG/WebP/PDF magic-byte verification.
- Create `src/lib/storage/upload-client.ts`: only permitted browser upload implementation.
- Create `src/lib/supabase/admin.ts`: guarded server-only service client.
- Create `src/app/actions/storage-uploads.ts`: authenticated ticket and finalization Server Actions.
- Create with CLI: migration ending `_add_payment_proof_paths.sql`.
- Create `scripts/local-db/payment-proof-paths-contract.test.mjs`: SQL contract.
- Modify `src/app/actions/imports.ts`, `src/app/actions/commissions.ts`: store paths instead of new public proof URLs.
- Modify `src/components/admin/ProductForm.tsx`, `src/components/forms/HangOrderModal.tsx`, `src/app/admin/banners/page.tsx`, `src/app/admin/imports/[id]/page.tsx`: signed catalog/banner uploads.
- Modify `src/app/profile/page.tsx`, `src/app/profile/imports/[id]/page.tsx`, `src/app/admin/commissions/page.tsx`: signed proof uploads.
- Create `src/lib/storage/payment-proof-access.ts` and `.test.ts`: legacy parsing, ownership and signed reads.
- Create `src/app/actions/payment-proof-access.ts`: owner/admin read action.
- Modify `src/app/admin/orders/page.tsx`, `src/app/admin/imports/page.tsx`, `src/app/admin/imports/[id]/page.tsx`, `src/app/admin/commissions/page.tsx`, `src/app/profile/page.tsx`, `src/app/profile/imports/[id]/page.tsx`: resolve proof on demand.
- Modify `scripts/local-db/prepare-storage-fixtures.ps1`, `scripts/local-db/storage-fixtures.sql`, `scripts/local-db/storage-matrix.mjs`: final local bucket/policy matrix.
- Create `scripts/local-db/payment-proof-backfill.mjs` and `.test.mjs`: local-only dry-run/apply rehearsal.
- Create `docs/runbooks/payment-proof-storage-transition.md`: staging/production phases and rollback.
- Modify `package.json`: focused unit, contract and local matrix commands.

### Task 1: Pure upload policy and canonical paths

**Files:**
- Create: `src/lib/storage/upload-policy.ts`
- Create: `src/lib/storage/upload-policy.test.ts`
- Create: `src/lib/storage/file-signatures.ts`
- Create: `src/lib/storage/file-signatures.test.ts`

**Interfaces:**
- Produces: `UploadKind`, `UploadIntent`, `ValidatedUploadIntent`, `validateUploadIntent`, `buildStoragePath`.
- Produces: `isAllowedFileSignature(bytes, mimeType) -> boolean`.

- [ ] **Step 1: Write failing policy tests**

Use the exact kinds and limits:

```ts
const MiB = 1024 * 1024

assert.deepEqual(
  validateUploadIntent({ kind: 'order-proof', name: 'proof.PDF', size: 5 * MiB, mimeType: 'application/pdf' }),
  { kind: 'order-proof', extension: 'pdf', size: 5 * MiB, mimeType: 'application/pdf' },
)
assert.throws(() => validateUploadIntent({
  kind: 'banner', name: 'payload.svg', size: 100, mimeType: 'image/svg+xml',
}))
assert.throws(() => validateUploadIntent({
  kind: 'order-proof', name: 'large.png', size: 5 * MiB + 1, mimeType: 'image/png',
}))
assert.throws(() => validateUploadIntent({
  kind: 'admin-product-image', name: '../escape.png', size: 100, mimeType: 'image/png',
}))
```

Path tests use fixed UUIDs:

```ts
assert.equal(buildStoragePath({
  kind: 'order-proof', userId: '11111111-1111-4111-8111-111111111111',
  recordId: '22222222-2222-4222-8222-222222222222',
  objectId: '33333333-3333-4333-8333-333333333333', extension: 'png',
}), 'orders/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.png')
```

Add exact tests for `requests`, `catalog`, `site`, `imports` and `commissions` prefixes.

- [ ] **Step 2: Write failing magic-byte tests**

Test signatures:

```ts
assert.equal(isAllowedFileSignature(Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), 'image/png'), true)
assert.equal(isAllowedFileSignature(Uint8Array.from([0xff,0xd8,0xff]), 'image/jpeg'), true)
assert.equal(isAllowedFileSignature(new TextEncoder().encode('RIFF1234WEBP'), 'image/webp'), true)
assert.equal(isAllowedFileSignature(new TextEncoder().encode('%PDF-1.7'), 'application/pdf'), true)
assert.equal(isAllowedFileSignature(new TextEncoder().encode('<script>'), 'image/png'), false)
```

- [ ] **Step 3: Run and confirm RED**

Run:

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --experimental-strip-types src/lib/storage/upload-policy.test.ts src/lib/storage/file-signatures.test.ts
```

Expected: FAIL because modules do not exist.

- [ ] **Step 4: Implement minimal pure modules**

Define:

```ts
export type UploadKind =
  | 'customer-product-request'
  | 'admin-product-image'
  | 'banner'
  | 'order-proof'
  | 'import-proof'
  | 'commission-proof'

export type UploadIntent = {
  kind: UploadKind
  name: string
  size: number
  mimeType: string
}
```

Use a closed MIME-to-extension map; do not trust the incoming extension independently. Reject non-integer/negative sizes, NUL/path separators, double extensions and MIME/extension mismatches. `buildStoragePath` accepts already validated IDs and always generates the final filename from `objectId` plus normalized extension.

- [ ] **Step 5: Run tests and commit**

Expected: focused tests PASS.

```bash
git add src/lib/storage/upload-policy.ts src/lib/storage/upload-policy.test.ts src/lib/storage/file-signatures.ts src/lib/storage/file-signatures.test.ts
git commit -m "feat: define safe storage upload contracts"
```

### Task 2: Server-only upload ticket core

**Files:**
- Create: `src/lib/supabase/admin.ts`
- Create: `src/lib/storage/upload-core.ts`
- Create: `src/lib/storage/upload-core.test.ts`
- Create: `src/lib/storage/upload-client.ts`
- Create: `src/app/actions/storage-uploads.ts`

**Interfaces:**
- Consumes: Task 1 validation/path functions and environment guard plan.
- Produces: `createUploadTicketCore(input, deps) -> Promise<UploadTicket>`.
- Produces: `verifyUploadedObjectCore(input, deps) -> Promise<void>`.
- Produces: `uploadWithTicket(file, ticket) -> Promise<{ bucket, path }>`.

- [ ] **Step 1: Write failing authorization tests with injected dependencies**

```ts
const ticket = await createUploadTicketCore(
  { kind: 'order-proof', recordId: orderId, name: 'proof.png', size: 8, mimeType: 'image/png' },
  {
    randomUUID: () => objectId,
    getActor: async () => ({ userId, email: 'tester@example.test', isAdmin: false, isCommissionAdmin: false }),
    assertRecordAccess: async ({ kind, recordId, actor }) => {
      assert.equal(kind, 'order-proof')
      assert.equal(recordId, orderId)
      assert.equal(actor.userId, userId)
    },
    createSignedUploadUrl: async (bucket, path) => ({ token: 'signed-token', path }),
  },
)
assert.deepEqual(ticket, { bucket: 'payment_proofs', path: expectedPath, token: 'signed-token' })
```

Negative tests prove non-admin cannot request banner/catalog tickets, wrong order owner is rejected before signing, commission requires commission admin, and dependency errors never include keys.

- [ ] **Step 2: Write failing finalization tests**

Mock stored metadata/bytes. Assert valid object passes; MIME/size/path mismatch calls `removeExactObject(bucket, path)` and throws; a missing object never updates business state.

- [ ] **Step 3: Run and confirm RED**

Run `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --experimental-strip-types src/lib/storage/upload-core.test.ts`.

Expected: FAIL because core does not exist.

- [ ] **Step 4: Implement guarded admin client**

`src/lib/supabase/admin.ts` starts with `import 'server-only'`, requires URL/service key, calls `assertSafeRuntimeSupabaseUrl` before `createClient`, and configures:

```ts
{ auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
```

It exports `createAdminClient()` only. No client component may import it.

- [ ] **Step 5: Implement ticket/finalization core**

Use `upsert: false` when calling `createSignedUploadUrl`. For verification, download at most the 5 MiB object through the admin client, compare stored `mimetype`/size to the ticket intent, and call `isAllowedFileSignature`. Remove only the exact invalid path.

- [ ] **Step 6: Implement thin Server Actions and one client helper**

The public responses are:

```ts
export type UploadTicket = { bucket: 'products' | 'banners' | 'payment_proofs'; path: string; token: string }
export async function createUploadTicketAction(input: UploadIntent & { recordId?: string; inventoryId?: string }): Promise<UploadTicket>
export async function uploadWithTicket(file: File, ticket: UploadTicket): Promise<{ bucket: string; path: string }>
```

`uploadWithTicket` is the only code that calls `.uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: file.type, upsert: false })`.

- [ ] **Step 7: Run tests/typecheck and commit**

```bash
git add src/lib/supabase/admin.ts src/lib/storage/upload-core.ts src/lib/storage/upload-core.test.ts src/lib/storage/upload-client.ts src/app/actions/storage-uploads.ts
git commit -m "feat: authorize exact storage upload paths"
```

### Task 3: Additive proof-path schema and order RPC

**Files:**
- Create with CLI: the file printed by `supabase migration new add_payment_proof_paths`, whose basename ends `_add_payment_proof_paths.sql`.
- Create: `scripts/local-db/payment-proof-paths-contract.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: nullable `payment_proof_path`/`proof_path` columns.
- Produces: `submit_order_payment_proof_path(order_id_input uuid, proof_path_input text)`.

- [ ] **Step 1: Write failing migration contract**

Resolve one migration by suffix and require:

```js
for (const fragment of [
  'alter table public.orders add column if not exists payment_proof_path text',
  'alter table public.import_orders add column if not exists payment_proof_path text',
  'alter table public.commission_payments add column if not exists proof_path text',
  'create or replace function public.submit_order_payment_proof_path',
  'set search_path = public, pg_temp',
  'revoke all on function public.submit_order_payment_proof_path(uuid, text) from public, anon',
  'grant execute on function public.submit_order_payment_proof_path(uuid, text) to authenticated, service_role',
]) assert.ok(sql.includes(fragment), `falta: ${fragment}`)
```

Also require the old URL columns are never dropped/renamed/overwritten.

- [ ] **Step 2: Confirm RED and create migration via CLI**

Run:

```powershell
node --test scripts/local-db/payment-proof-paths-contract.test.mjs
supabase migration new add_payment_proof_paths
```

Expected: test RED before migration creation.

- [ ] **Step 3: Write forward-only SQL**

The RPC must:

```sql
if auth.uid() is null then
  raise exception 'Debes iniciar sesión.' using errcode = '42501';
end if;
if proof_path_input !~ ('^orders/' || auth.uid()::text || '/' || order_id_input::text || '/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|pdf)$') then
  raise exception 'Ruta de comprobante inválida.' using errcode = '22023';
end if;

update public.orders
set status = 'verifying_payment', payment_proof_path = proof_path_input
where id = order_id_input
  and user_id = auth.uid()
  and status in ('pending_payment', 'verifying_payment');

if not found then
  raise exception 'Orden no disponible.' using errcode = '42501';
end if;
```

It does not set `payment_proof_url`. Keep the legacy `submit_order_payment_proof(uuid,text)` unchanged for one compatibility release.

- [ ] **Step 4: Apply to local container and verify contract**

Pipe only the generated migration into `supabase_db_crimson-crown` with `ON_ERROR_STOP=1`. Run the contract and `npm run test:local-security`.

Expected: columns nullable, old data untouched, RPC ownership checks PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json scripts/local-db/payment-proof-paths-contract.test.mjs supabase/migrations/*_add_payment_proof_paths.sql
git commit -m "feat: add canonical payment proof paths"
```

### Task 4: Migrate public catalog and banner writers

**Files:**
- Modify: `src/components/admin/ProductForm.tsx`
- Modify: `src/components/forms/HangOrderModal.tsx`
- Modify: `src/app/admin/banners/page.tsx`
- Modify: `src/app/admin/imports/[id]/page.tsx`
- Create: `scripts/local-db/storage-upload-callsite.test.mjs`

**Interfaces:**
- Consumes: Task 2 ticket/client helper.
- Produces: public URL derived only after an authorized signed upload.

- [ ] **Step 1: Write failing static callsite test**

```js
for (const file of browserWriters) {
  const source = await readFile(file, 'utf8')
  assert.doesNotMatch(source, /\.storage\.from\([^)]*\)\.upload\(/)
  assert.match(source, /createUploadTicketAction/)
  assert.match(source, /uploadWithTicket/)
}
```

The allowlist contains only `src/lib/storage/upload-client.ts` for `uploadToSignedUrl`.

- [ ] **Step 2: Confirm RED**

Run `node --test scripts/local-db/storage-upload-callsite.test.mjs`.

Expected: FAIL on all four existing direct writers.

- [ ] **Step 3: Replace each writer**

- `ProductForm`: kind `admin-product-image`, existing selected `inventoryId`.
- admin import item image: kind `admin-product-image`, selected active inventory.
- banners: kind `banner`.
- `HangOrderModal`: kind `customer-product-request`; actor ID comes from server session, never client input.

After `uploadWithTicket`, derive public catalog/banner URL with `getPublicUrl(ticket.path)`. Preserve existing database image URL fields.

- [ ] **Step 4: Run callsite, component contract, typecheck**

Expected: no direct upload call remains in these files; TypeScript PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/ProductForm.tsx src/components/forms/HangOrderModal.tsx src/app/admin/banners/page.tsx src/app/admin/imports/[id]/page.tsx scripts/local-db/storage-upload-callsite.test.mjs
git commit -m "feat: route public asset uploads through tickets"
```

### Task 5: Migrate proof writers and business finalization

**Files:**
- Modify: `src/app/profile/page.tsx`
- Modify: `src/app/profile/imports/[id]/page.tsx`
- Modify: `src/app/admin/commissions/page.tsx`
- Modify: `src/app/actions/storage-uploads.ts`
- Modify: `src/app/actions/imports.ts`
- Modify: `src/app/actions/commissions.ts`
- Create: `src/lib/storage/proof-finalization-core.ts`
- Create: `src/lib/storage/proof-finalization-core.test.ts`

**Interfaces:**
- Produces: `finalizeOrderProofAction(orderId, path)`, `approveImportQuoteAction(orderId, proofPath, credits)`, commission input `proofPath`.

- [ ] **Step 1: Write failing finalization unit tests**

Assert exact order:

```ts
assert.deepEqual(calls, [
  'authorize-owner',
  'verify-object',
  'persist-path-and-status',
])
```

On verify failure, assert no persistence. On persistence failure, keep object for bounded orphan cleanup and return a stable error. Test import fully paid by credits permits `proofPath = null`.

- [ ] **Step 2: Confirm RED**

Run focused Node tests. Expected: FAIL because core/actions do not exist.

- [ ] **Step 3: Implement order/import/commission finalizers**

- Stock order verifies object then calls `submit_order_payment_proof_path` through the authenticated server client.
- Import action confirms `import_orders.user_id === auth.uid()`, verifies `imports/<uid>/<id>/...`, stores `payment_proof_path`, and leaves `payment_proof_url` unchanged.
- Commission action requires commission admin, verifies `commissions/<period>/<uid>/...`, stores `proof_path`, and leaves `proof_url` unchanged.
- Commission email removes the direct proof hyperlink and keeps only `/admin/commissions`.

- [ ] **Step 4: Replace three browser writers**

Each page requests a ticket, uses `uploadWithTicket`, then calls its finalizer with path. Optimistic state stores `payment_proof_path`/`proof_path`, not a public URL.

- [ ] **Step 5: Run callsite scan, unit tests and typecheck**

Expected: no direct `.upload()` or new `getPublicUrl()` for `payment_proofs`; tests/typecheck PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/profile/page.tsx src/app/profile/imports/[id]/page.tsx src/app/admin/commissions/page.tsx src/app/actions/storage-uploads.ts src/app/actions/imports.ts src/app/actions/commissions.ts src/lib/storage/proof-finalization-core.ts src/lib/storage/proof-finalization-core.test.ts
git commit -m "feat: finalize payment proofs by canonical path"
```

### Task 6: Owner/admin signed proof reads with legacy fallback

**Files:**
- Create: `src/lib/storage/payment-proof-access.ts`
- Create: `src/lib/storage/payment-proof-access.test.ts`
- Create: `src/app/actions/payment-proof-access.ts`
- Modify: six proof-reader pages listed in File map.

**Interfaces:**
- Produces: `parseLegacyProofPath(rawUrl, allowedOrigin) -> string | null`.
- Produces: `getPaymentProofUrlAction({ domain, recordId }) -> { url, expiresAt }`.

- [ ] **Step 1: Write failing parser/authorization tests**

```ts
assert.equal(
  parseLegacyProofPath(
    'https://djfqozfaqkqdoqeoqbzt.supabase.co/storage/v1/object/public/payment_proofs/orders/a.png',
    'https://djfqozfaqkqdoqeoqbzt.supabase.co',
  ),
  'orders/a.png',
)
assert.equal(parseLegacyProofPath('https://jzkxvgntwompkntimrao.supabase.co/storage/v1/object/public/payment_proofs/a.png', allowedOrigin), null)
assert.equal(parseLegacyProofPath('javascript:alert(1)', allowedOrigin), null)
```

Authorization tests prove owner can read own order/import proof, another user cannot, commission proof requires admin, and `anon` never receives a URL.

- [ ] **Step 2: Confirm RED**

Run focused tests. Expected: missing module/actions FAIL.

- [ ] **Step 3: Implement path-first resolver**

For each domain, fetch only `user_id`, path and legacy URL. Prefer path; if null, parse the legacy URL against the current Crimson/local origin and `payment_proofs` bucket. Call `createSignedUrl(path, 300)` on the server and return expiry `Date.now() + 300_000`. Never persist the signed URL.

- [ ] **Step 4: Replace direct proof links**

Buttons call the Server Action on click, open/show the returned five-minute URL, clear it on modal close, and show a stable error if denied/expired. Emails link only to authenticated application pages.

- [ ] **Step 5: Run tests/typecheck and commit**

```bash
git add src/lib/storage/payment-proof-access.ts src/lib/storage/payment-proof-access.test.ts src/app/actions/payment-proof-access.ts src/app/admin/orders/page.tsx src/app/admin/imports/page.tsx src/app/admin/imports/[id]/page.tsx src/app/admin/commissions/page.tsx src/app/profile/page.tsx src/app/profile/imports/[id]/page.tsx
git commit -m "feat: serve payment proofs with signed urls"
```

### Task 7: Final local bucket settings and negative Storage matrix

**Files:**
- Modify: `scripts/local-db/prepare-storage-fixtures.ps1`
- Modify: `scripts/local-db/storage-fixtures.sql`
- Modify: `scripts/local-db/storage-matrix.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: ticket/finalization/read actions.
- Produces: local final-state simulation: public catalog reads, private proof reads, no direct browser writes.

- [ ] **Step 1: Make direct-write tests fail before policy changes**

Expand the matrix so `anon`, standard and admin clients all fail direct `INSERT`, `UPDATE`, `DELETE` in all three buckets. Assert public catalog/banner download works and anonymous proof download fails after private transition.

- [ ] **Step 2: Configure exact bucket limits locally**

Update fixtures:

```powershell
$bucketConfig = @{
  products = @{ public = $true; allowed = @('image/jpeg','image/png','image/webp') }
  banners = @{ public = $true; allowed = @('image/jpeg','image/png','image/webp') }
  payment_proofs = @{ public = $false; allowed = @('image/jpeg','image/png','image/webp','application/pdf') }
}
```

Use `file_size_limit = 5242880` for all. Existing buckets are updated with the Storage API; 409 is handled only on create, not treated as successful update.

- [ ] **Step 3: Replace policies with least privilege**

Drop the four old local upload policies. Do not create client DML policies. Service-role signed tickets remain the only upload path. Keep no public proof SELECT policy; products/banners are public buckets for reads.

- [ ] **Step 4: Test signed upload and reads end to end locally**

Use the running local app or injected action harness to obtain tickets. Assert exact-path upload succeeds, token cannot upload a different path, owner/admin signed read succeeds, cross-owner/anon fails, invalid MIME/oversize fails, and cleanup removes every synthetic object.

- [ ] **Step 5: Run full storage gate and commit**

Run:

```powershell
npm run local-storage:prepare
npm run test:local-storage
npm run test:environment-safety
npm run typecheck
```

Expected: all PASS with zero residual synthetic objects.

```bash
git add package.json scripts/local-db/prepare-storage-fixtures.ps1 scripts/local-db/storage-fixtures.sql scripts/local-db/storage-matrix.mjs
git commit -m "security: enforce private proof storage locally"
```

### Task 8: Idempotent backfill rehearsal and transition runbook

**Files:**
- Create: `scripts/local-db/payment-proof-backfill.mjs`
- Create: `scripts/local-db/payment-proof-backfill.test.mjs`
- Create: `docs/runbooks/payment-proof-storage-transition.md`

**Interfaces:**
- Produces: dry-run default report `{ scanned, resolvable, missingObject, foreignUrl, invalidFormat, alreadyPathed }`.
- Applies only with `--apply` and loopback URL.

- [ ] **Step 1: Write failing parser/idempotence tests**

Fixtures cover all three legacy columns, valid local/Crimson URLs, foreign ref, missing object, already-pathed row and repeat application. Assert reports contain counts and IDs truncated to eight characters, never emails/URLs.

- [ ] **Step 2: Confirm RED**

Run `node --test scripts/local-db/payment-proof-backfill.test.mjs`.

- [ ] **Step 3: Implement local-only dry-run/apply**

The script loads `.env.test.local`, requires loopback port `54621`, defaults to dry-run, selects only IDs/path/legacy URL, checks object existence, and updates nullable path columns in batches of 50 only under `--apply`. A second `--apply` produces zero updates.

- [ ] **Step 4: Seed and rehearse both modes**

Run dry-run, assert source rows unchanged; run `--apply`, assert only resolvable rows changed; run again, assert idempotent zero; clean fixtures.

- [ ] **Step 5: Write phased runbook**

Document eight spec phases, exact pre/post queries, exception report, five-minute signed URL behavior, rollback by restoring policy/code compatibility, and the prohibition on deleting objects/legacy columns. The production-private step is explicitly manual and last.

- [ ] **Step 6: Commit**

```bash
git add scripts/local-db/payment-proof-backfill.mjs scripts/local-db/payment-proof-backfill.test.mjs docs/runbooks/payment-proof-storage-transition.md
git commit -m "docs: rehearse payment proof storage transition"
```

## Plan completion gate

- All direct browser uploads are eliminated outside `upload-client.ts`.
- Every new object path is canonical and authorized server-side.
- Business state changes only after actual object verification.
- Proof readers enforce owner/admin and issue five-minute URLs.
- Local final-state bucket matrix passes with `payment_proofs` private.
- Legacy URL columns/objects remain intact and the backfill rehearsal is idempotent.
- No production Storage, row or policy was changed.
