import {
  parseAdminProductInput,
  type AdminProductInput,
  type AdminProductMutationResult,
  type DeleteAdminProductsInput,
  type DeleteAdminProductsResult,
  type ImportAdminProductsInput,
  type ImportAdminProductsResult,
  type SaveAdminProductInput,
} from './product-mutations.ts'

export type ProductMutationRpcRow = {
  product_id: string
  mutation_kind: 'inserted' | 'restocked' | 'updated'
  previous_stock: number
  current_stock: number
}

export type AdminProductGateway = {
  requireAdmin(): Promise<{ userId: string }>
  createOrRestock(args: {
    inventoryId: string
    product: AdminProductInput
    operationKey: string
  }): Promise<ProductMutationRpcRow>
  update(args: {
    productId: string
    inventoryId: string
    product: AdminProductInput
    operationKey: string
  }): Promise<ProductMutationRpcRow>
  findProduct(productId: string, inventoryId: string): Promise<Record<string, unknown>>
  deleteMany(args: {
    inventoryId: string
    productIds: string[]
    operationKey: string
  }): Promise<{ deletedIds: string[]; rejectedIds: string[] }>
  notifyStockArrivals(items: Array<{ id: string; name: string }>): Promise<void>
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const OPERATION_KEY_PATTERN = /^[A-Za-z0-9:_-]{8,160}$/
const IMPORT_CHUNK_SIZE = 5
const MAX_IMPORT_ROWS = 5000

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

function isOperationKey(value: unknown): value is string {
  return typeof value === 'string' && OPERATION_KEY_PATTERN.test(value.trim())
}

function errorCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) return ''
  return String((error as { code?: unknown }).code || '')
}

function stableError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message === 'Acceso denegado.') return error.message

  switch (errorCode(error)) {
    case '42501':
      return 'Acceso denegado.'
    case '22023':
      return 'Los datos del producto son inválidos.'
    case '23503':
      return 'El inventario o producto ya no está disponible.'
    case '23505':
      return 'Ya existe una variante incompatible en este inventario.'
    default:
      return fallback
  }
}

function validateMutationEnvelope(input: SaveAdminProductInput) {
  if (!isUuid(input?.inventoryId)) return { success: false as const, error: 'Falta un inventario válido.' }
  if (input.productId != null && !isUuid(input.productId)) {
    return { success: false as const, error: 'El producto seleccionado es inválido.' }
  }
  if (!isOperationKey(input?.operationKey)) {
    return { success: false as const, error: 'Clave de operación inválida.' }
  }
  return parseAdminProductInput(input.product)
}

export function createAdminProductActionCore(gateway: AdminProductGateway): {
  save(input: SaveAdminProductInput): Promise<AdminProductMutationResult>
  importRows(input: ImportAdminProductsInput): Promise<ImportAdminProductsResult>
  deleteMany(input: DeleteAdminProductsInput): Promise<DeleteAdminProductsResult>
} {
  async function saveAuthorized(input: SaveAdminProductInput): Promise<AdminProductMutationResult> {
    const parsed = validateMutationEnvelope(input)
    if (!parsed.success) return parsed

    try {
      const transition = input.productId
        ? await gateway.update({
            productId: input.productId,
            inventoryId: input.inventoryId,
            product: parsed.data,
            operationKey: input.operationKey.trim(),
          })
        : await gateway.createOrRestock({
            inventoryId: input.inventoryId,
            product: parsed.data,
            operationKey: input.operationKey.trim(),
          })
      const product = await gateway.findProduct(transition.product_id, input.inventoryId)

      return {
        success: true,
        data: {
          product,
          mutationKind: transition.mutation_kind,
          previousStock: Number(transition.previous_stock),
          currentStock: Number(transition.current_stock),
        },
      }
    } catch (error) {
      return { success: false, error: stableError(error, 'No se pudo guardar el producto.') }
    }
  }

  return {
    async save(input) {
      try {
        await gateway.requireAdmin()
      } catch (error) {
        return { success: false, error: stableError(error, 'Acceso denegado.') }
      }
      const result = await saveAuthorized(input)
      if (result.success && result.data.currentStock > result.data.previousStock) {
        const id = String(result.data.product.id || '')
        const name = String(result.data.product.name || '')
        if (isUuid(id)) {
          try {
            await gateway.notifyStockArrivals([{ id, name }])
          } catch {
            // El producto ya fue confirmado por la base; la alerta se puede
            // reintentar sin presentar la mutación como fallida.
          }
        }
      }
      return result
    },

    async importRows(input) {
      try {
        await gateway.requireAdmin()
      } catch (error) {
        return { success: false, error: stableError(error, 'Acceso denegado.') }
      }

      if (!isUuid(input?.inventoryId)) return { success: false, error: 'Falta un inventario válido.' }
      if (!Array.isArray(input.rows)) return { success: false, error: 'El archivo de productos es inválido.' }
      if (input.rows.length > MAX_IMPORT_ROWS) {
        return { success: false, error: `El archivo no puede superar ${MAX_IMPORT_ROWS} productos.` }
      }

      let inserted = 0
      let updated = 0
      const errors: Array<{ index: number; error: string }> = []
      const arrivals = new Map<string, { id: string; name: string }>()

      for (let start = 0; start < input.rows.length; start += IMPORT_CHUNK_SIZE) {
        const chunk = input.rows.slice(start, start + IMPORT_CHUNK_SIZE)
        const outcomes = await Promise.all(chunk.map(async (row, offset) => ({
          index: start + offset,
          result: await saveAuthorized({
            inventoryId: input.inventoryId,
            operationKey: row?.operationKey,
            product: row?.product,
          }),
        })))

        for (const outcome of outcomes) {
          if (!outcome.result.success) {
            errors.push({ index: outcome.index, error: outcome.result.error })
            continue
          }

          if (outcome.result.data.mutationKind === 'inserted') inserted += 1
          else updated += 1

          if (outcome.result.data.currentStock > outcome.result.data.previousStock) {
            const id = String(outcome.result.data.product.id || '')
            const name = String(outcome.result.data.product.name || '')
            if (isUuid(id)) arrivals.set(id, { id, name })
          }
        }
      }

      const stockArrivals = [...arrivals.values()]
      if (stockArrivals.length > 0) {
        try {
          await gateway.notifyStockArrivals(stockArrivals)
        } catch {
          // Las escrituras ya fueron confirmadas; una alerta fallida no debe
          // presentar la importación idempotente como si se hubiera revertido.
        }
      }

      return { success: true, data: { inserted, updated, errors, stockArrivals } }
    },

    async deleteMany(input) {
      try {
        await gateway.requireAdmin()
      } catch (error) {
        return { success: false, error: stableError(error, 'Acceso denegado.') }
      }

      if (!isUuid(input?.inventoryId)) return { success: false, error: 'Falta un inventario válido.' }
      if (!isOperationKey(input?.operationKey)) return { success: false, error: 'Clave de operación inválida.' }
      if (!Array.isArray(input.productIds) || input.productIds.length === 0) {
        return { success: false, error: 'Selecciona al menos un producto.' }
      }

      const productIds = [...new Set(input.productIds)]
      if (productIds.some((id) => !isUuid(id))) {
        return { success: false, error: 'La selección contiene productos inválidos.' }
      }

      try {
        const data = await gateway.deleteMany({
          inventoryId: input.inventoryId,
          productIds,
          operationKey: input.operationKey.trim(),
        })
        return { success: true, data }
      } catch (error) {
        return { success: false, error: stableError(error, 'No se pudieron eliminar los productos.') }
      }
    },
  }
}
