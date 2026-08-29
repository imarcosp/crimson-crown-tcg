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

export type AdminProductMutationResult =
  | {
      success: true
      data: {
        product: Record<string, unknown>
        mutationKind: 'inserted' | 'restocked' | 'updated'
        previousStock: number
        currentStock: number
      }
    }
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
  | {
      success: true
      data: {
        inserted: number
        updated: number
        errors: Array<{ index: number; error: string }>
        stockArrivals: Array<{ id: string; name: string }>
      }
    }
  | { success: false; error: string }

export type DeleteAdminProductsInput = {
  inventoryId: string
  productIds: string[]
  operationKey: string
}

export type DeleteAdminProductsResult =
  | { success: true; data: { deletedIds: string[]; rejectedIds: string[] } }
  | { success: false; error: string }

const normalizeText = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ')

function normalizeOptionalText(value: unknown) {
  const normalized = normalizeText(value)
  return normalized || null
}

function invalidRequiredText(field: string) {
  return { success: false as const, error: `${field} del producto es obligatorio.` }
}

export function parseAdminProductInput(input: unknown): ProductInputResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { success: false, error: 'Los datos del producto son inválidos.' }
  }

  const candidate = input as Record<string, unknown>
  const name = normalizeText(candidate.name)
  const setName = normalizeText(candidate.set_name)
  const tcg = normalizeText(candidate.tcg)
  const condition = normalizeText(candidate.condition)
  const finish = normalizeText(candidate.finish)
  const language = normalizeText(candidate.language)

  if (!name) return invalidRequiredText('El nombre')
  if (!setName) return invalidRequiredText('El set')
  if (!tcg) return invalidRequiredText('El TCG')
  if (!condition) return invalidRequiredText('La condición')
  if (!finish) return invalidRequiredText('El acabado')
  if (!language) return invalidRequiredText('El idioma')

  if (typeof candidate.stock !== 'number' || !Number.isInteger(candidate.stock) || candidate.stock < 0) {
    return { success: false, error: 'El stock debe ser un entero no negativo.' }
  }

  if (typeof candidate.price_usd !== 'number' || !Number.isFinite(candidate.price_usd) || candidate.price_usd < 0) {
    return { success: false, error: 'El precio debe ser un número no negativo.' }
  }

  let metadata: Record<string, unknown> = {}
  if (candidate.metadata !== undefined && candidate.metadata !== null) {
    if (
      typeof candidate.metadata !== 'object'
      || Array.isArray(candidate.metadata)
      || Object.getPrototypeOf(candidate.metadata) !== Object.prototype
    ) {
      return { success: false, error: 'Los metadatos del producto son inválidos.' }
    }
    metadata = { ...(candidate.metadata as Record<string, unknown>) }
  }

  return {
    success: true,
    data: {
      name,
      set_name: setName,
      collector_number: normalizeOptionalText(candidate.collector_number),
      tcg,
      price_usd: candidate.price_usd,
      stock: candidate.stock,
      condition,
      finish,
      rarity: normalizeText(candidate.rarity),
      image_url: normalizeText(candidate.image_url),
      scryfall_id: normalizeOptionalText(candidate.scryfall_id),
      is_manual_price: candidate.is_manual_price === true,
      language,
      metadata,
    },
  }
}
