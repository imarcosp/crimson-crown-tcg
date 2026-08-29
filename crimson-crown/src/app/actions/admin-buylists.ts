"use server"

import { createGuardedSupabaseClient as createAdminClient } from '@/lib/supabase/guarded-constructors'
import { createClient } from "@/lib/supabase/server"
import { ADMIN_EMAILS } from "@/lib/constants"
import { sendBuylistNotification } from "@/app/actions/email"

type BuylistCondition = "NM" | "EX" | "VG" | "G" | "HP" | "DMG"

export type AdminManualQuoteItemInput = {
  id: string
  name: string
  image_url?: string | null
  set_name?: string | null
  collector_number?: string | null
  scryfall_id?: string | null
  quantity: number
  isFoil?: boolean
  condition?: string
  offered_price_unit: number
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null) {
    const maybe = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown }
    const parts = [maybe.code, maybe.message, maybe.details, maybe.hint]
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter(Boolean)
    if (parts.length > 0) return parts.join(" | ")
  }
  return fallback
}

function createServiceRoleClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function requireAdminUser() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user?.email || !ADMIN_EMAILS.includes(user.email)) {
    throw new Error("Acceso denegado.")
  }

  return { user }
}

function normalizeCondition(raw: unknown): BuylistCondition {
  const value = String(raw || "").trim().toUpperCase()
  if (value === "EX" || value === "VG" || value === "G" || value === "HP" || value === "DMG") return value
  return "NM"
}

async function resolveBuylistProductId(admin: ReturnType<typeof createServiceRoleClient>, item: AdminManualQuoteItemInput) {
  const uuidRe = /^[0-9a-fA-F-]{36}$/
  if (typeof item.id === "string" && uuidRe.test(item.id)) {
    return item.id
  }

  if (item.scryfall_id && uuidRe.test(String(item.scryfall_id))) {
    const { data: prodByScry } = await admin
      .from("products")
      .select("id")
      .eq("scryfall_id", String(item.scryfall_id))
      .limit(1)
      .maybeSingle()

    if (prodByScry?.id) return String(prodByScry.id)
  }

  let query = admin.from("products").select("id").limit(1)
  query = query.ilike("name", `%${String(item.name || "").replace(/%/g, "")}%`)
  if (item.set_name) query = query.ilike("set_name", `%${String(item.set_name).replace(/%/g, "")}%`)
  if (item.collector_number) query = query.eq("collector_number", String(item.collector_number))

  const { data: prodByMeta } = await query.maybeSingle()
  if (prodByMeta?.id) return String(prodByMeta.id)

  return null
}

async function getProfileMap(admin: ReturnType<typeof createServiceRoleClient>, userIds: string[]) {
  const ids = [...new Set(userIds.filter(Boolean))]
  if (ids.length === 0) return new Map<string, any>()

  const { data } = await admin
    .from("profiles")
    .select("id, email, first_name, last_name, phone")
    .in("id", ids)

  return new Map((data || []).map((profile: any) => [String(profile.id), profile]))
}

async function getUserEmail(
  admin: ReturnType<typeof createServiceRoleClient>,
  userId: string,
  fallbackEmail?: string | null
) {
  const safeFallback = String(fallbackEmail || "").trim()
  if (safeFallback) return safeFallback

  try {
    const { data, error } = await admin.auth.admin.getUserById(userId)
    if (error) return null
    return String(data.user?.email || "").trim() || null
  } catch {
    return null
  }
}

function buildManualQuoteItemsPayload(orderId: string, items: AdminManualQuoteItemInput[], productIds: string[]) {
  return items.map((item, index) => ({
    buylist_id: orderId,
    product_id: productIds[index],
    quantity: Math.max(1, Number(item.quantity || 1)),
    offered_price_unit: Math.max(0, Number(item.offered_price_unit || 0)),
    condition: normalizeCondition(item.condition),
    is_foil: Boolean(item.isFoil),
    notes: null,
    card_name: String(item.name || "").trim(),
    set_name: item.set_name ? String(item.set_name).trim() : null,
    image_url: item.image_url ? String(item.image_url).trim() : null,
    collector_number: item.collector_number ? String(item.collector_number).trim() : null,
  }))
}

export async function searchAdminManualBuylistUsers(query: string) {
  try {
    await requireAdminUser()
    const admin = createServiceRoleClient()
    const term = String(query || "").trim()

    if (term.length < 2) {
      return { success: true, users: [] }
    }

    const like = `%${term.replace(/%/g, "").replace(/,/g, " ").trim()}%`
    const { data, error } = await admin
      .from("profiles")
      .select("id, first_name, last_name, email")
      .or(`email.ilike.${like},first_name.ilike.${like},last_name.ilike.${like}`)
      .limit(12)

    if (error) {
      return { success: false, error: getErrorMessage(error, "No se pudo buscar usuarios."), users: [] }
    }

    return { success: true, users: data || [] }
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "No se pudo buscar usuarios."), users: [] }
  }
}

export async function createAdminManualBuylistDraft(userId: string) {
  try {
    const { user } = await requireAdminUser()
    const admin = createServiceRoleClient()

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id, email")
      .eq("id", userId)
      .single()

    if (profileError || !profile?.id) {
      return { success: false, error: "No encontramos al usuario seleccionado." }
    }

    const { data: order, error } = await admin
      .from("buylist_orders")
      .insert({
        user_id: userId,
        status: "draft",
        total_offered: 0,
        created_by_admin_id: user.id,
        sent_at: null,
      })
      .select("id")
      .single()

    if (error || !order?.id) {
      return { success: false, error: getErrorMessage(error, "No se pudo crear el borrador.") }
    }

    return { success: true, orderId: String(order.id) }
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "No se pudo crear el borrador.") }
  }
}

export async function getAdminBuylistList() {
  try {
    await requireAdminUser()
    const admin = createServiceRoleClient()

    const { data, error } = await admin
      .from("buylist_orders")
      .select("id, created_at, user_id, status, total_offered, sent_at, created_by_admin_id, buylist_items(id)")
      .order("created_at", { ascending: false })

    if (error) {
      return { success: false, error: getErrorMessage(error, "No se pudieron cargar las solicitudes."), orders: [] }
    }

    const profileMap = await getProfileMap(admin, (data || []).map((order: any) => String(order.user_id || "")))
    const orders = (data || []).map((order: any) => ({
      ...order,
      profile: profileMap.get(String(order.user_id || "")) || null,
    }))

    return { success: true, orders }
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "No se pudieron cargar las solicitudes."), orders: [] }
  }
}

export async function getAdminBuylistDetail(orderId: string) {
  try {
    await requireAdminUser()
    const admin = createServiceRoleClient()
    const id = String(orderId || "").trim()

    if (!id) {
      return { success: false, error: "Falta el ID de la cotización." }
    }

    const { data, error } = await admin
      .from("buylist_orders")
      .select(`
        id,
        user_id,
        created_at,
        status,
        total_offered,
        sent_at,
        created_by_admin_id,
        buylist_items (
          id,
          product_id,
          quantity,
          offered_price_unit,
          condition,
          is_foil,
          notes,
          card_name,
          set_name,
          image_url,
          collector_number
        )
      `)
      .eq("id", id)
      .single()

    if (error || !data?.id) {
      return { success: false, error: getErrorMessage(error, "No encontramos la cotización.") }
    }

    const profileMap = await getProfileMap(admin, [String(data.user_id || "")])
    const productIds = (Array.isArray(data.buylist_items) ? data.buylist_items : [])
      .map((item: any) => String(item?.product_id || "").trim())
      .filter(Boolean)
    const { data: productsData } = productIds.length
      ? await admin
          .from("products")
          .select("id, image_url, price_usd, price_usd_foil, finish, language")
          .in("id", productIds)
      : { data: [] as any[] }
    const productMap = new Map((productsData || []).map((product: any) => [String(product.id), product]))

    return {
      success: true,
      order: {
        ...data,
        buylist_items: (Array.isArray(data.buylist_items) ? data.buylist_items : []).map((item: any) => ({
          ...item,
          products: productMap.get(String(item?.product_id || "")) || null,
        })),
        profile: profileMap.get(String(data.user_id || "")) || null,
      },
    }
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "No encontramos la cotización.") }
  }
}

export async function saveAdminManualBuylistQuote(params: {
  orderId: string
  items: AdminManualQuoteItemInput[]
  sendToUser: boolean
}) {
  try {
    await requireAdminUser()
    const admin = createServiceRoleClient()
    const orderId = String(params.orderId || "").trim()

    if (!orderId) {
      return { success: false, error: "Falta la cotización." }
    }

    const { data: order, error: orderError } = await admin
      .from("buylist_orders")
      .select("id, user_id, status, created_by_admin_id, sent_at")
      .eq("id", orderId)
      .single()

    if (orderError || !order?.id) {
      return { success: false, error: "No encontramos la cotización." }
    }

    if (!order.created_by_admin_id) {
      return { success: false, error: "Esta solicitud no corresponde a una cotización manual del staff." }
    }

    const currentStatus = String(order.status || "").toLowerCase()
    if (["completed", "rejected", "cancelled"].includes(currentStatus)) {
      return { success: false, error: "Esta cotización ya no se puede editar." }
    }

    const sanitizedItems = (params.items || [])
      .map((item) => ({
        ...item,
        id: String(item.id || "").trim(),
        name: String(item.name || "").trim(),
        quantity: Math.max(1, Number(item.quantity || 1)),
        offered_price_unit: Math.max(0, Number(item.offered_price_unit || 0)),
        condition: normalizeCondition(item.condition),
        isFoil: Boolean(item.isFoil),
        set_name: item.set_name ? String(item.set_name).trim() : null,
        collector_number: item.collector_number ? String(item.collector_number).trim() : null,
        image_url: item.image_url ? String(item.image_url).trim() : null,
        scryfall_id: item.scryfall_id ? String(item.scryfall_id).trim() : null,
      }))
      .filter((item) => item.name)

    if (sanitizedItems.length === 0) {
      return { success: false, error: "Debes cargar al menos una carta en la cotización." }
    }

    const productIds: string[] = []
    for (const item of sanitizedItems) {
      const productId = await resolveBuylistProductId(admin, item)
      if (!productId) {
        return {
          success: false,
          error: `No se pudo vincular esta carta con el catálogo: ${item.name}${item.set_name ? ` (${item.set_name})` : ""}${item.collector_number ? ` #${item.collector_number}` : ""}.`,
        }
      }
      productIds.push(productId)
    }

    const itemsPayload = buildManualQuoteItemsPayload(orderId, sanitizedItems, productIds)
    const totalOffered = itemsPayload.reduce((sum, item) => {
      return sum + Number(item.offered_price_unit || 0) * Number(item.quantity || 0)
    }, 0)

    const wasAlreadySent = Boolean(order.sent_at) || currentStatus === "waiting_user_approval"
    const nextStatus = params.sendToUser
      ? "waiting_user_approval"
      : wasAlreadySent
        ? String(order.status || "waiting_user_approval")
        : "draft"
    const nextSentAt = params.sendToUser
      ? new Date().toISOString()
      : wasAlreadySent
        ? order.sent_at || null
        : null

    const { error: deleteError } = await admin.from("buylist_items").delete().eq("buylist_id", orderId)
    if (deleteError) {
      return { success: false, error: getErrorMessage(deleteError, "No se pudo actualizar el detalle.") }
    }

    const { error: insertError } = await admin.from("buylist_items").insert(itemsPayload)
    if (insertError) {
      return { success: false, error: getErrorMessage(insertError, "No se pudieron guardar las cartas.") }
    }

    const { error: updateError } = await admin
      .from("buylist_orders")
      .update({
        total_offered: totalOffered,
        status: nextStatus,
        sent_at: nextSentAt,
      })
      .eq("id", orderId)

    if (updateError) {
      return { success: false, error: getErrorMessage(updateError, "No se pudo actualizar la cotización.") }
    }

    if (params.sendToUser) {
      const profileMap = await getProfileMap(admin, [String(order.user_id || "")])
      const profile = profileMap.get(String(order.user_id || "")) || null
      let emailWarning: string | null = null

      await admin.from("notifications").insert({
        user_id: order.user_id,
        type: "buylist",
        title: "Cotización de compra lista",
        message: `Tu cotización #${orderId.slice(0, 8)} ya está disponible para revisar.`,
        link: "/profile?tab=quotes",
      })

      const userEmail = await getUserEmail(admin, String(order.user_id || ""), profile?.email)
      if (userEmail) {
        const name = [profile.first_name, profile.last_name].filter(Boolean).join(" ")
        const emailResult = await sendBuylistNotification({
          type: "manual_quote_ready",
          buylistId: orderId,
          userEmail,
          userName: name || undefined,
          total: totalOffered,
          link: `${process.env.NEXT_PUBLIC_BASE_URL || ""}/profile?tab=quotes`,
        })

        if (!emailResult?.success) {
          emailWarning = emailResult?.error || "La cotización se envió en la web, pero el correo no pudo salir."
        }
      } else {
        emailWarning = "La cotización se envió en la web, pero no encontramos un email válido del usuario."
      }

      return { success: true, totalOffered, status: nextStatus, sentAt: nextSentAt, emailWarning }
    }

    return { success: true, totalOffered, status: nextStatus, sentAt: nextSentAt }
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "No se pudo guardar la cotización.") }
  }
}
