import { createHash } from 'node:crypto'

export const LOCAL_DB_CONTAINER = 'supabase_db_crimson-crown'

const DATA_CLASSIFICATION = Object.freeze({
  'auth.users': 'restricted_identity',
  'storage.buckets': 'operational_metadata',
  'storage.objects': 'restricted_storage',
  'public.admin_users': 'restricted_access',
  'public.analytics_visits': 'restricted_personal',
  'public.banners': 'public_content',
  'public.buylist_items': 'restricted_commerce',
  'public.buylist_orders': 'restricted_commerce',
  'public.cart_items': 'restricted_personal',
  'public.commission_adjustments': 'restricted_financial',
  'public.commission_payment_allocations': 'restricted_financial',
  'public.commission_payments': 'restricted_financial',
  'public.commission_period_lines': 'restricted_financial',
  'public.commission_periods': 'restricted_financial',
  'public.coupons': 'restricted_commerce',
  'public.credit_transactions': 'restricted_financial',
  'public.deck_builder_cards': 'public_catalog',
  'public.deck_builder_decks': 'public_catalog',
  'public.deck_builder_snapshots': 'operational_metadata',
  'public.external_prices': 'public_catalog',
  'public.faqs': 'public_content',
  'public.feedback': 'restricted_personal',
  'public.home_quick_links': 'public_content',
  'public.import_items': 'restricted_commerce',
  'public.import_orders': 'restricted_commerce',
  'public.inventories': 'internal_operational',
  'public.inventory_stock_movements': 'internal_operational',
  'public.manual_price_backup_magic_once_20260526': 'internal_operational',
  'public.notifications': 'restricted_personal',
  'public.order_items': 'restricted_commerce',
  'public.orders': 'restricted_commerce',
  'public.price_history': 'internal_operational',
  'public.price_opportunities': 'internal_operational',
  'public.products': 'public_catalog',
  'public.profiles': 'restricted_identity',
  'public.saved_items': 'restricted_personal',
  'public.search_logs': 'restricted_personal',
  'public.system_settings': 'internal_operational',
  'public.wishlists': 'restricted_personal',
})

const SAFE_OBJECT_NAME = /^(?:auth|public|storage)[.][a-z_][a-z0-9_]*$/u

export function classifyDataObject(objectName) {
  const classification = DATA_CLASSIFICATION[objectName]
  if (!classification) {
    throw new Error(`Objeto sin clasificación explícita: ${objectName}`)
  }
  return classification
}

function quoteObjectName(objectName) {
  if (!SAFE_OBJECT_NAME.test(objectName)) {
    throw new Error(`Nombre de objeto no permitido: ${objectName}`)
  }
  return objectName
    .split('.')
    .map((part) => `"${part}"`)
    .join('.')
}

export function buildCountSql(objectNames) {
  const unique = [...new Set(objectNames)].sort()
  if (unique.length === 0) throw new Error('No hay objetos para contar.')

  const selects = unique.map((objectName) => {
    const quoted = quoteObjectName(objectName)
    return `select '${objectName}'::text as object_name, count(*)::bigint as row_count from ${quoted}`
  })

  return `select jsonb_agg(jsonb_build_object('object_name', object_name, 'row_count', row_count) order by object_name) from (${selects.join(' union all ')}) counts;`
}

export function buildSnapshotEnvelope({ generatedAt, schemaSnapshot, rowCounts }) {
  if (!/^\d{4}-\d{2}-\d{2}T/u.test(generatedAt)) throw new Error('Fecha de snapshot inválida.')
  if (!schemaSnapshot || typeof schemaSnapshot !== 'object') throw new Error('Snapshot de esquema inválido.')
  if (!Array.isArray(rowCounts) || rowCounts.length === 0) throw new Error('Conteos inválidos.')

  const classifications = rowCounts.map(({ object_name: objectName, row_count: rowCount }) => {
    if (!Number.isSafeInteger(Number(rowCount)) || Number(rowCount) < 0) {
      throw new Error(`Conteo inválido para ${objectName}.`)
    }
    return {
      object_name: objectName,
      classification: classifyDataObject(objectName),
    }
  })

  return {
    schema_version: 1,
    generated_at: generatedAt,
    source: {
      kind: 'supabase_local',
      container: LOCAL_DB_CONTAINER,
      contains_row_values: false,
    },
    schema: schemaSnapshot,
    row_counts: rowCounts,
    classifications,
  }
}

export function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

export function buildTimestampedName(prefix, generatedAt, extension) {
  const stamp = generatedAt.replace(/[-:]/gu, '').replace(/[.].*$/u, '').replace('T', '-')
  if (!/^[a-z][a-z0-9-]*$/u.test(prefix) || !/^[a-z0-9]+$/u.test(extension)) {
    throw new Error('Nombre de artefacto inválido.')
  }
  return `${prefix}-${stamp}Z.${extension}`
}
