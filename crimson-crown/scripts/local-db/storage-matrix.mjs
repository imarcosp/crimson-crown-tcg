import assert from 'node:assert/strict'
import dotenv from 'dotenv'
import { createOperationalSupabaseClient as createClient } from '../lib/guarded-supabase-client.mjs'

dotenv.config({ path: '.env.test.local', override: true })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const hostname = url ? new URL(url).hostname : ''
if (!url || !anonKey || !serviceKey || !['127.0.0.1', 'localhost', '::1'].includes(hostname)) {
  throw new Error('La matriz de Storage sólo puede ejecutarse con credenciales locales.')
}

const identities = {
  standard: { email: 'tester.local@example.test', password: 'CrimsonLocalTester!2026' },
  admin: { email: 'admin.local@example.test', password: 'CrimsonLocalAdmin!2026' },
}

function client() {
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function signedIn(identity) {
  const supabase = client()
  const { error } = await supabase.auth.signInWithPassword(identities[identity])
  if (error) throw new Error(`No se pudo iniciar sesión como ${identity}: ${error.message}`)
  return supabase
}

const png = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' })
const suffix = Date.now()
const paths = {
  payment: `security/payment-${suffix}.png`,
  importImage: `imports/security-${suffix}.png`,
  productRoot: `security/product-${suffix}.png`,
  banner: `security/banner-${suffix}.png`,
}

async function main() {
  const standard = await signedIn('standard')
  const admin = await signedIn('admin')
  const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const uploaded = []

  try {
    const payment = await standard.storage.from('payment_proofs').upload(paths.payment, png)
    assert.ifError(payment.error)
    uploaded.push(['payment_proofs', paths.payment])

    const importImage = await standard.storage.from('products').upload(paths.importImage, png)
    assert.ifError(importImage.error)
    uploaded.push(['products', paths.importImage])

    const productRoot = await standard.storage.from('products').upload(paths.productRoot, png)
    assert.ok(productRoot.error, 'standard no debe subir imágenes fuera de imports/')

    const banner = await standard.storage.from('banners').upload(paths.banner, png)
    assert.ok(banner.error, 'standard no debe subir banners')

    const adminBanner = await admin.storage.from('banners').upload(paths.banner, png)
    assert.ifError(adminBanner.error)
    uploaded.push(['banners', paths.banner])

    console.log(JSON.stringify({ ok: true, buckets: ['payment_proofs', 'products', 'banners'], uploaded: uploaded.length }, null, 2))
  } finally {
    for (const [bucket, path] of uploaded) {
      const { error } = await service.storage.from(bucket).remove([path])
      if (error) throw new Error(`no se pudo limpiar ${bucket}/${path}: ${error.message}`)
    }
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
