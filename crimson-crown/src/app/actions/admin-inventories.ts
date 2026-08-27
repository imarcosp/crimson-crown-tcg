'use server'

import { createClient } from '@/lib/supabase/server'
import { isAdminEmail } from '@/lib/auth/admin-access'

export type Inventory = {
  id: string
  name: string
  description: string | null
  location_label: string | null
  kind: 'primary' | 'secondary'
  is_active: boolean
  created_at: string
  updated_at: string
  archived_at: string | null
}

export type InventoryActionResult<T = undefined> =
  | { success: true; data: T }
  | { success: false; error: string }

function errorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message?: unknown }).message || '').trim()
    if (message) return message
  }
  return fallback
}

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user || !isAdminEmail(user.email)) {
    throw new Error('Acceso denegado.')
  }
  return supabase
}

function normalizeInventory(data: unknown): Inventory | null {
  if (!data || typeof data !== 'object') return null
  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row !== 'object') return null
  return row as Inventory
}

export async function getAdminInventories(): Promise<InventoryActionResult<Inventory[]>> {
  try {
    const supabase = await requireAdmin()
    const { data, error } = await supabase
      .from('inventories')
      .select('id,name,description,location_label,kind,is_active,created_at,updated_at,archived_at')
      .order('kind', { ascending: true })
      .order('created_at', { ascending: true })

    if (error) return { success: false, error: errorMessage(error, 'No se pudieron cargar los inventarios.') }
    return { success: true, data: (data || []) as Inventory[] }
  } catch (error) {
    return { success: false, error: errorMessage(error, 'No se pudieron cargar los inventarios.') }
  }
}

export async function createAdminInventory(input: {
  name: string
  description?: string
  locationLabel?: string
}): Promise<InventoryActionResult<Inventory>> {
  try {
    const name = String(input?.name || '').trim()
    if (!name) return { success: false, error: 'El nombre del inventario es obligatorio.' }

    const supabase = await requireAdmin()
    const { data, error } = await supabase.rpc('create_inventory', {
      name_input: name,
      description_input: String(input?.description || '').trim() || null,
      location_label_input: String(input?.locationLabel || '').trim() || null,
    })
    if (error) return { success: false, error: errorMessage(error, 'No se pudo crear el inventario.') }

    const inventory = normalizeInventory(data)
    return inventory
      ? { success: true, data: inventory }
      : { success: false, error: 'El inventario se creó, pero no se pudo leer su información.' }
  } catch (error) {
    return { success: false, error: errorMessage(error, 'No se pudo crear el inventario.') }
  }
}

export async function setAdminInventoryActive(id: string, active: boolean): Promise<InventoryActionResult<Inventory>> {
  try {
    const inventoryId = String(id || '').trim()
    if (!inventoryId) return { success: false, error: 'Falta el inventario.' }

    const supabase = await requireAdmin()
    const { data, error } = await supabase.rpc('set_inventory_active', {
      inventory_id_input: inventoryId,
      is_active_input: Boolean(active),
    })
    if (error) return { success: false, error: errorMessage(error, 'No se pudo cambiar el estado del inventario.') }

    const inventory = normalizeInventory(data)
    return inventory
      ? { success: true, data: inventory }
      : { success: false, error: 'No se pudo leer el inventario actualizado.' }
  } catch (error) {
    return { success: false, error: errorMessage(error, 'No se pudo cambiar el estado del inventario.') }
  }
}

export async function archiveAdminInventory(id: string): Promise<InventoryActionResult<Inventory>> {
  try {
    const inventoryId = String(id || '').trim()
    if (!inventoryId) return { success: false, error: 'Falta el inventario.' }
    const supabase = await requireAdmin()
    const { data, error } = await supabase.rpc('archive_inventory', { inventory_id_input: inventoryId })
    if (error) return { success: false, error: errorMessage(error, 'No se pudo archivar el inventario.') }
    const inventory = normalizeInventory(data)
    return inventory
      ? { success: true, data: inventory }
      : { success: false, error: 'No se pudo leer el inventario archivado.' }
  } catch (error) {
    return { success: false, error: errorMessage(error, 'No se pudo archivar el inventario.') }
  }
}

export async function deleteAdminInventory(id: string): Promise<InventoryActionResult<number>> {
  try {
    const inventoryId = String(id || '').trim()
    if (!inventoryId) return { success: false, error: 'Falta el inventario.' }
    const supabase = await requireAdmin()
    const { data, error } = await supabase.rpc('delete_inventory_safely', { inventory_id_input: inventoryId })
    if (error) return { success: false, error: errorMessage(error, 'No se pudo eliminar el inventario.') }
    return { success: true, data: Number(data || 0) }
  } catch (error) {
    return { success: false, error: errorMessage(error, 'No se pudo eliminar el inventario.') }
  }
}
