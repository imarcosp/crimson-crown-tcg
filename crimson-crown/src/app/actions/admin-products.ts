'use server'

import { processWishlistNotifications } from '@/app/actions/wishlist'
import { isAdminEmail } from '@/lib/auth/admin-access'
import {
  createAdminProductActionCore,
  type AdminProductGateway,
  type ProductMutationRpcRow,
} from '@/lib/admin/product-action-core'
import type {
  AdminProductMutationResult,
  DeleteAdminProductsInput,
  DeleteAdminProductsResult,
  ImportAdminProductsInput,
  ImportAdminProductsResult,
  SaveAdminProductInput,
} from '@/lib/admin/product-mutations'
import { createClient } from '@/lib/supabase/server'

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>

function rpcRow(data: unknown): ProductMutationRpcRow {
  const value = Array.isArray(data) ? data[0] : data
  if (!value || typeof value !== 'object') throw new Error('La base no devolvió el producto actualizado.')
  const row = value as Record<string, unknown>
  const mutationKind = String(row.mutation_kind || '')
  if (!['inserted', 'restocked', 'updated'].includes(mutationKind)) {
    throw new Error('La base devolvió una transición de producto inválida.')
  }

  return {
    product_id: String(row.product_id || ''),
    mutation_kind: mutationKind as ProductMutationRpcRow['mutation_kind'],
    previous_stock: Number(row.previous_stock),
    current_stock: Number(row.current_stock),
  }
}

function createGateway(): AdminProductGateway {
  let authenticatedClient: ServerSupabaseClient | null = null

  function supabase() {
    if (!authenticatedClient) throw new Error('Acceso denegado.')
    return authenticatedClient
  }

  return {
    async requireAdmin() {
      const candidate = await createClient()
      const { data: { user }, error } = await candidate.auth.getUser()
      if (error || !user || !isAdminEmail(user.email)) throw new Error('Acceso denegado.')
      authenticatedClient = candidate
      return { userId: user.id }
    },

    async createOrRestock({ inventoryId, product, operationKey }) {
      const { data, error } = await supabase().rpc('admin_create_or_restock_product', {
        inventory_id_input: inventoryId,
        product_input: product,
        operation_key_input: operationKey,
      })
      if (error) throw error
      return rpcRow(data)
    },

    async update({ productId, inventoryId, product, operationKey }) {
      const { data, error } = await supabase().rpc('admin_update_product', {
        product_id_input: productId,
        inventory_id_input: inventoryId,
        product_input: product,
        operation_key_input: operationKey,
      })
      if (error) throw error
      return rpcRow(data)
    },

    async findProduct(productId, inventoryId) {
      const { data, error } = await supabase()
        .from('products')
        .select('*')
        .eq('id', productId)
        .eq('inventory_id', inventoryId)
        .single()
      if (error || !data) throw error || new Error('No se encontró el producto actualizado.')
      return data as Record<string, unknown>
    },

    async deleteMany({ inventoryId, productIds, operationKey }) {
      const { data, error } = await supabase().rpc('admin_delete_products', {
        inventory_id_input: inventoryId,
        product_ids_input: productIds,
        operation_key_input: operationKey,
      })
      if (error) throw error
      const value = Array.isArray(data) ? data[0] : data
      if (!value || typeof value !== 'object') throw new Error('La base no devolvió el resultado del borrado.')
      const row = value as Record<string, unknown>
      return {
        deletedIds: Array.isArray(row.deleted_ids) ? row.deleted_ids.map(String) : [],
        rejectedIds: Array.isArray(row.rejected_ids) ? row.rejected_ids.map(String) : [],
      }
    },

    async notifyStockArrivals(items) {
      const result = await processWishlistNotifications(items)
      if (result?.success === false) throw new Error('No se pudieron procesar las alertas de wishlist.')
    },
  }
}

export async function saveAdminProduct(input: SaveAdminProductInput): Promise<AdminProductMutationResult> {
  return createAdminProductActionCore(createGateway()).save(input)
}

export async function importAdminProducts(input: ImportAdminProductsInput): Promise<ImportAdminProductsResult> {
  return createAdminProductActionCore(createGateway()).importRows(input)
}

export async function deleteAdminProducts(input: DeleteAdminProductsInput): Promise<DeleteAdminProductsResult> {
  return createAdminProductActionCore(createGateway()).deleteMany(input)
}
