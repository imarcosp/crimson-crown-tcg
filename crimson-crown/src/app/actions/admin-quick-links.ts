'use server'

import { revalidatePath } from 'next/cache'

import { isAdminEmail } from '@/lib/auth/admin-access'
import { normalizeQuickLinkInput, type HomeQuickLinkRecord } from '@/lib/home/quick-links'
import { createClient } from '@/lib/supabase/server'

export type HomeQuickLink = HomeQuickLinkRecord

export type QuickLinkActionResult<T = undefined> =
  | { success: true; data: T }
  | { success: false; error: string }

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user || !isAdminEmail(user.email)) throw new Error('Acceso denegado.')
  return supabase
}

function normalizeId(value: unknown) {
  const id = String(value ?? '').trim().toLowerCase()
  if (!UUID_PATTERN.test(id)) throw new Error('Acceso rápido inválido.')
  return id
}

function toHomeQuickLink(value: unknown): HomeQuickLink | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as HomeQuickLink
}

function failure(message: string): QuickLinkActionResult<never> {
  return { success: false, error: message }
}

function refreshQuickLinks() {
  revalidatePath('/')
  revalidatePath('/admin/quick-links')
}

export async function getAdminQuickLinks(): Promise<QuickLinkActionResult<HomeQuickLink[]>> {
  try {
    const supabase = await requireAdmin()
    const { data, error } = await supabase
      .from('home_quick_links')
      .select('id,label,url,image_url,icon_key,display_order,active,created_at,updated_at')
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: true })
    if (error) return failure('No se pudieron cargar los accesos rápidos.')
    return { success: true, data: (data || []) as HomeQuickLink[] }
  } catch {
    return failure('No se pudieron cargar los accesos rápidos.')
  }
}

export async function saveAdminQuickLink(
  rawInput: unknown,
  rawId?: unknown,
): Promise<QuickLinkActionResult<HomeQuickLink>> {
  try {
    const input = normalizeQuickLinkInput(rawInput)
    const supabase = await requireAdmin()
    const payload = {
      label: input.label,
      url: input.url,
      image_url: input.imageUrl,
      icon_key: input.iconKey,
      display_order: input.displayOrder,
      active: input.active,
      updated_at: new Date().toISOString(),
    }

    const query = rawId
      ? supabase.from('home_quick_links').update(payload).eq('id', normalizeId(rawId))
      : supabase.from('home_quick_links').insert(payload)
    const { data, error } = await query
      .select('id,label,url,image_url,icon_key,display_order,active,created_at,updated_at')
      .single()
    const quickLink = toHomeQuickLink(data)
    if (error || !quickLink) return failure('No se pudo guardar el acceso rápido.')

    refreshQuickLinks()
    return { success: true, data: quickLink }
  } catch (error) {
    const message = error instanceof Error && /etiqueta|URL|orden|acceso rápido/iu.test(error.message)
      ? error.message
      : 'No se pudo guardar el acceso rápido.'
    return failure(message)
  }
}

export async function setAdminQuickLinkActive(
  rawId: unknown,
  active: unknown,
): Promise<QuickLinkActionResult<HomeQuickLink>> {
  try {
    if (typeof active !== 'boolean') return failure('Estado inválido.')
    const supabase = await requireAdmin()
    const { data, error } = await supabase
      .from('home_quick_links')
      .update({ active, updated_at: new Date().toISOString() })
      .eq('id', normalizeId(rawId))
      .select('id,label,url,image_url,icon_key,display_order,active,created_at,updated_at')
      .single()
    const quickLink = toHomeQuickLink(data)
    if (error || !quickLink) return failure('No se pudo cambiar el estado.')

    refreshQuickLinks()
    return { success: true, data: quickLink }
  } catch {
    return failure('No se pudo cambiar el estado.')
  }
}

export async function deleteAdminQuickLink(rawId: unknown): Promise<QuickLinkActionResult<string>> {
  try {
    const id = normalizeId(rawId)
    const supabase = await requireAdmin()
    const { error } = await supabase.from('home_quick_links').delete().eq('id', id)
    if (error) return failure('No se pudo eliminar el acceso rápido.')

    refreshQuickLinks()
    return { success: true, data: id }
  } catch {
    return failure('No se pudo eliminar el acceso rápido.')
  }
}
