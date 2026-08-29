import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const root = process.cwd()
const browserWriters = [
  'src/components/admin/ProductForm.tsx',
  'src/components/forms/HangOrderModal.tsx',
  'src/app/admin/banners/page.tsx',
  'src/app/admin/imports/[id]/page.tsx',
]
const proofWriters = [
  {
    file: 'src/app/profile/page.tsx',
    kind: 'order-proof',
    finalizer: 'finalizeOrderProofAction',
  },
  {
    file: 'src/app/profile/imports/[id]/page.tsx',
    kind: 'import-proof',
    finalizer: 'approveImportQuoteAction',
  },
  {
    file: 'src/app/admin/commissions/page.tsx',
    kind: 'commission-proof',
    finalizer: 'reportCommissionPaymentAction',
  },
]

async function source(file) {
  return readFile(path.join(root, file), 'utf8')
}

async function listSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name)
    return entry.isDirectory() ? listSourceFiles(absolute) : [absolute]
  }))
  return files.flat()
}

test('public browser writers use the authorized upload ticket boundary', async () => {
  for (const file of browserWriters) {
    const contents = await source(file)

    assert.doesNotMatch(contents, /\.storage\s*\.from\([^)]*\)\s*\.upload\s*\(/u, file)
    assert.match(contents, /createUploadTicketAction/u, file)
    assert.match(contents, /uploadWithTicket/u, file)
    assert.doesNotMatch(contents, /(?:service_role|SUPABASE_SERVICE_ROLE_KEY|@\/lib\/supabase\/admin)/u, file)
    assert.doesNotMatch(contents, /console\.[a-z]+\([^\n]*(?:ticket\.token|signedToken|signed_token)/u, file)
  }
})

test('each writer requests the intended kind and server-owned authorization context', async () => {
  const product = await source(browserWriters[0])
  const hangOrder = await source(browserWriters[1])
  const banners = await source(browserWriters[2])
  const importDetail = await source(browserWriters[3])

  assert.match(product, /createUploadTicketAction\(\{[\s\S]*?kind:\s*['"]admin-product-image['"][\s\S]*?inventoryId[\s\S]*?\}\)/u)
  assert.match(banners, /createUploadTicketAction\(\{[\s\S]*?kind:\s*['"]banner['"][\s\S]*?\}\)/u)

  const hangTicketInput = hangOrder.match(/createUploadTicketAction\(\{([\s\S]*?)\}\)/u)?.[1] ?? ''
  assert.match(hangTicketInput, /kind:\s*['"]customer-product-request['"]/u)
  assert.doesNotMatch(hangTicketInput, /(?:actor|userId|user_id|email)\s*:/u)

  assert.match(importDetail, /getAdminInventories/u)
  assert.match(importDetail, /inventory\.is_active\s*&&\s*!inventory\.archived_at/u)
  assert.match(importDetail, /inventoryId:\s*selectedActiveInventoryId/u)
  assert.match(importDetail, /createUploadTicketAction\(\{[\s\S]*?kind:\s*['"]admin-product-image['"][\s\S]*?\}\)/u)
})

test('public URLs are derived from the authorized path only after upload succeeds', async () => {
  for (const file of browserWriters) {
    const contents = await source(file)
    const uploadIndex = contents.indexOf('await uploadWithTicket')
    const publicUrlIndex = contents.indexOf('getPublicUrl(ticket.path)', uploadIndex)

    assert.notEqual(uploadIndex, -1, file)
    assert.ok(publicUrlIndex > uploadIndex, file)
  }

  assert.match(await source(browserWriters[0]), /image_url/u)
  assert.match(await source(browserWriters[1]), /image:\s*finalImageUrl/u)
  assert.match(await source(browserWriters[2]), /image_url:\s*finalUrl/u)
  assert.match(await source(browserWriters[3]), /image_url:\s*finalImageUrl/u)
})

test('uploadToSignedUrl remains isolated to the browser upload helper', async () => {
  const matches = []
  const files = await listSourceFiles(path.join(root, 'src'))
  for (const file of files.filter((candidate) => /\.[cm]?[jt]sx?$/u.test(candidate))) {
    if (/\.uploadToSignedUrl\s*\(/u.test(await readFile(file, 'utf8'))) {
      matches.push(path.relative(root, file).replaceAll('\\', '/'))
    }
  }

  assert.deepEqual(matches, ['src/lib/storage/upload-client.ts'])
})

test('payment proof writers upload with a ticket before their server finalizer', async () => {
  for (const { file, kind, finalizer } of proofWriters) {
    const contents = await source(file)
    const ticketIndex = contents.indexOf('await createUploadTicketAction')
    const uploadIndex = contents.indexOf('await uploadWithTicket', ticketIndex)
    const finalizerIndex = contents.indexOf(`await ${finalizer}`, uploadIndex)

    assert.notEqual(ticketIndex, -1, file)
    assert.ok(uploadIndex > ticketIndex, file)
    assert.ok(finalizerIndex > uploadIndex, file)
    assert.match(contents, new RegExp(`kind:\\s*['"]${kind}['"]`, 'u'), file)
    assert.doesNotMatch(contents, /\.storage\s*\.from\([^)]*payment_proofs[^)]*\)\s*\.upload\s*\(/u, file)
    assert.doesNotMatch(contents, /getPublicUrl\s*\(/u, file)
    assert.doesNotMatch(contents, /(?:service_role|SUPABASE_SERVICE_ROLE_KEY|@\/lib\/supabase\/admin)/u, file)
    assert.doesNotMatch(contents, /console\.[a-z]+\([^\n]*(?:ticket\.token|signedToken|signed_token)/u, file)
  }
})

test('proof finalizers persist canonical paths without changing legacy URL fields', async () => {
  const storageAction = await source('src/app/actions/storage-uploads.ts')
  const importsAction = await source('src/app/actions/imports.ts')
  const commissionsAction = await source('src/app/actions/commissions.ts')

  assert.match(storageAction, /verifyTrustedUploadedObject/u)
  assert.match(storageAction, /submit_order_payment_proof_path/u)
  assert.match(storageAction, /createAdminClient\(\)[\s\S]*?\.rpc\(['"]submit_order_payment_proof_path['"]/u)
  assert.doesNotMatch(storageAction, /submit_order_payment_proof(?!_path)/u)

  assert.match(importsAction, /verifyTrustedUploadedObject/u)
  assert.match(importsAction, /approve_import_quote_atomic/u)
  assert.match(importsAction, /proof_path_input:\s*proofPath/u)
  assert.match(importsAction, /user_id_input:\s*context\.userId/u)
  assert.doesNotMatch(importsAction, /payment_proof_url\s*:/u)

  assert.match(commissionsAction, /verifyTrustedUploadedObject/u)
  assert.match(commissionsAction, /proof_path/u)
  assert.match(commissionsAction, /requireCommissionAdmin\(\)/u)
  assert.doesNotMatch(commissionsAction, /proof_url\s*:/u)
  assert.doesNotMatch(commissionsAction, /Comprobante:<\/strong>[\s\S]*?href=/u)
  assert.match(commissionsAction, /\/admin\/commissions/u)
})

test('admin import modal routes every open and close through image upload cleanup', async () => {
  const importDetail = await source('src/app/admin/imports/[id]/page.tsx')

  assert.match(
    importDetail,
    /const openModal = \(item\?: any\) => \{[\s\S]*?resetImportImageState\(item\?\.image_url \|\| ''\)[\s\S]*?setShowModal\(true\)/u,
  )
  assert.match(
    importDetail,
    /const closeItemModal = \(\) => \{[\s\S]*?resetImportImageState\(\)[\s\S]*?setShowModal\(false\)/u,
  )
  assert.equal(importDetail.match(/onClick=\{closeItemModal\}/gu)?.length, 2)
  assert.match(importDetail, /closeItemModal\(\);\s*fetchOrder\(\)/u)
  assert.doesNotMatch(importDetail, /onClick=\{\(\) => setShowModal\(false\)\}/u)
})
