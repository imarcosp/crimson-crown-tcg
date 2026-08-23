"use server"

import { createServerClient } from '@supabase/ssr'
import { sendOrderEmails } from '@/app/actions/email'
import { cookies } from 'next/headers'
import { requiresCheckoutAddress } from './checkout-helpers'

type ContactDetails = {
  name: string
  lastname: string
  phone: string
}

export async function placeOrder(
  items: any[],
  couponCode?: string,
  shippingDetails?: any,
  useCredits?: boolean,
  contactDetails?: ContactDetails,
) {
  console.log('🟢 [Server] placeOrder INICIADO')
  console.log('📦 [Checkout] Items:', JSON.stringify(items.map((item) => ({ id: item.id, qty: item.quantity }))))
  if (couponCode) console.log('🎟️ [Checkout] Cupón:', couponCode)
  if (shippingDetails) console.log('🚚 [Checkout] Envío:', JSON.stringify(shippingDetails))

  try {
    if (!contactDetails?.name || !contactDetails?.lastname || !contactDetails?.phone) {
      console.error('⛔ [Server] Faltan datos de contacto')
      return { success: false, error: 'Por favor completa los datos de contacto (Nombre, Apellido, Teléfono).' }
    }

    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) { return cookieStore.get(name)?.value },
          set(name: string, value: string, options: any) {
            try { cookieStore.set({ name, value, ...options }) } catch {}
          },
          remove(name: string, options: any) {
            try { cookieStore.set({ name, value: '', ...options }) } catch {}
          },
        },
      },
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      console.error('⛔ [Server] Fallo Auth:', authError?.message || 'No User')
      return { success: false, error: 'Usuario no autenticado' }
    }

    const { error: profileError } = await supabase.rpc('update_profile_details', {
      first_name_input: contactDetails.name,
      last_name_input: contactDetails.lastname,
      phone_input: contactDetails.phone,
    })
    if (profileError) throw profileError

    if (requiresCheckoutAddress(shippingDetails?.method)) {
      const address = shippingDetails?.address || {}
      const required = [address.street, address.city, address.province, address.zip]
      if (required.some((value: any) => !value || String(value).trim() === '')) {
        console.error('⛔ [Server] Dirección incompleta para método de envío')
        return { success: false, error: 'Dirección incompleta para envío' }
      }
    }

    const { data: orderId, error: orderError } = await supabase.rpc('place_order_atomic', {
      p_items: items.map((item) => ({ id: item.id, quantity: item.quantity })),
      p_coupon_code: couponCode || null,
      p_delivery_method: shippingDetails?.method || 'pickup',
      p_shipping_address: shippingDetails?.address || null,
      p_use_credits: Boolean(useCredits),
      p_contact_name: contactDetails.name,
      p_contact_lastname: contactDetails.lastname,
      p_contact_phone: contactDetails.phone,
    })
    if (orderError || !orderId) throw orderError || new Error('No se pudo crear la orden')

    const { data: order, error: orderReadError } = await supabase
      .from('orders')
      .select('id,total_amount')
      .eq('id', orderId)
      .single()
    if (orderReadError || !order) throw orderReadError || new Error('No se pudo leer la orden creada')

    const { data: orderItems, error: orderItemsError } = await supabase
      .from('order_items')
      .select('quantity,price_at_purchase,products(name)')
      .eq('order_id', orderId)
    if (orderItemsError) throw orderItemsError

    const emailItems = (orderItems || []).map((item: any) => ({
      name: item.products?.name || 'Producto',
      quantity: Number(item.quantity || 0),
      price_usd: Number(item.price_at_purchase || 0),
    }))

    try {
      await sendOrderEmails(orderId, user.email || '', emailItems, Number(order.total_amount || 0))
    } catch (mailError) {
      console.error('⚠️ La orden se creó pero falló el envío de mail:', mailError)
    }

    return { success: true, orderId }
  } catch (error: any) {
    console.error('💥 [Server] EXCEPCIÓN FATAL:', error)
    return { success: false, error: error.message }
  }
}
