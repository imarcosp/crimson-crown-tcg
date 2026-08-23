"use server"

import { createServerClient } from '@supabase/ssr'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { sendOrderEmails } from '@/app/actions/email'
import { cookies } from 'next/headers'

type ContactDetails = {
  name: string
  lastname: string
  phone: string
}

export async function placeOrder(items: any[], couponCode?: string, shippingDetails?: any, useCredits?: boolean, contactDetails?: ContactDetails) {
  console.log('🟢 [Server] placeOrder INICIADO')
  console.log('📦 [Checkout] Items:', JSON.stringify(items.map(i => ({ id: i.id, qty: i.quantity }))))
  if (couponCode) console.log('🎟️ [Checkout] Cupón:', couponCode)
  if (shippingDetails) console.log('🚚 [Checkout] Envío:', JSON.stringify(shippingDetails))

  try {
    if (!contactDetails?.name || !contactDetails?.lastname || !contactDetails?.phone) {
      console.error('⛔ [Server] Faltan datos de contacto')
      return { success: false, error: 'Por favor completa los datos de contacto (Nombre, Apellido, Teléfono).' }
    }
    const cookieStore = await cookies()
    console.log('🍪 [Server] Cookies cargadas')
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) { return cookieStore.get(name)?.value },
          set(name: string, value: string, options: any) { try { cookieStore.set({ name, value, ...options }) } catch (error) {} },
          remove(name: string, options: any) { try { cookieStore.set({ name, value: '', ...options }) } catch (error) {} },
        },
      }
    )
    const serviceSupabase = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      console.error('⛔ [Server] Fallo Auth:', authError?.message || 'No User')
      return { success: false, error: 'Usuario no autenticado' }
    }
    console.log('👤 [Server] Usuario autenticado:', (user as any).email)

    const { error: profileError } = await supabase.rpc('update_profile_details', {
      first_name_input: contactDetails.name,
      last_name_input: contactDetails.lastname,
      phone_input: contactDetails.phone,
    })
    if (profileError) throw profileError

    if (['moto', 'shipping'].includes(shippingDetails?.method)) {
      const a = shippingDetails?.address || {}
      const required = [a.street, a.city, a.province, a.zip]
      if (required.some((v: any) => !v || String(v).trim() === '')) {
        console.error('⛔ [Server] Dirección incompleta para método de envío')
        return { success: false, error: 'Dirección incompleta para envío' }
      }
    }

    let calculatedTotal = 0
    let subtotal = 0
    let discountAmount = 0
    const resolvedItems: Array<{ id: string; quantity: number; price_usd: number; name: string }> = []
    console.log('💰 [Server] Calculando totales...')

    for (const item of items) {
      const { data: product, error } = await supabase
        .from('products')
        .select('stock, price_usd, name')
        .eq('id', item.id)
        .single()

      if (error || !product) {
        console.error(`❌ [Checkout] Producto no encontrado: ${item.id}`, error)
        throw new Error(`Producto inválido: ${item.id}`)
      }

      console.log(`🔍 [Stock Check] ${product.name}: Pide ${item.quantity}, Hay ${product.stock}`)

      if ((product as any).stock < item.quantity) {
        console.error(`⛔ [Checkout] Stock insuficiente para ${product.name}`)
        throw new Error(`Stock insuficiente para: ${product.name}`)
      }

      const unit = Number((product as any).price_usd) || 0
      calculatedTotal += unit * item.quantity
      subtotal += unit * item.quantity
      resolvedItems.push({ id: item.id, quantity: item.quantity, price_usd: unit, name: (product as any).name })
    }

    if (couponCode) {
      const { data: coupon } = await supabase
        .from('coupons')
        .select('*')
        .eq('code', couponCode)
        .eq('active', true)
        .single()
      if (coupon) {
        console.log("✅ [Checkout] Cupón válido encontrado:", (coupon as any).code)
        const preCouponTotal = calculatedTotal
        if ((coupon as any).discount_type === 'percentage') {
          discountAmount = preCouponTotal * ((coupon as any).value / 100)
        } else {
          discountAmount = Number((coupon as any).value) || 0
        }
        discountAmount = Math.min(preCouponTotal, Math.max(0, discountAmount))
        calculatedTotal = Math.max(0, preCouponTotal - discountAmount)
      }
    }

    calculatedTotal = Math.max(0, calculatedTotal)

    let creditsApplied = 0
    let newStatus = 'pending_payment'
    const notes: string[] = []
    const shipNote = (() => {
      const m = shippingDetails?.method
      if (!m) return null
      if (m === 'pickup') return 'Entrega: Retiro en Tienda (Almagro)'
      if (m === 'moto') return 'Entrega: Moto Mensajería (CABA/GBA) - A coordinar / Pago en destino'
      const a = shippingDetails?.address
      return a ? `Entrega: Correo Argentino | ${a.street}, ${a.city}, ${a.province} (${a.zip})` : 'Entrega: Correo Argentino'
    })()
    if (shipNote) notes.push(shipNote as string)
    notes.push(`Contacto: ${contactDetails.name} ${contactDetails.lastname} (${contactDetails.phone})`)

    if (useCredits) {
      const { data: prof } = await supabase.from('profiles').select('credits').eq('id', user.id).single()
      const available = Number((prof as any)?.credits || 0)
      const creditsToDeduct = Math.min(calculatedTotal, available)
      creditsApplied = creditsToDeduct
      if (creditsToDeduct > 0) {
        const { error: creditError } = await supabase.rpc('manage_credits', {
          target_user_id: user.id,
          amount_change: -creditsToDeduct,
          transaction_type: 'purchase',
          transaction_desc: 'Pago orden (Pendiente)',
          ref_id: null,
        })
        if (creditError) throw new Error('Error procesando créditos: ' + creditError.message)
        notes.push(`Pago con créditos: US$ ${creditsToDeduct.toFixed(2)}`)
        const remaining = Math.max(0, calculatedTotal - creditsToDeduct)
        if (remaining === 0) newStatus = 'paid'
        calculatedTotal = remaining
      }
    }

    // 1. DEDUCCIÓN DE STOCK (LO PRIMERO Y MÁS IMPORTANTE)
    // Se hace ANTES de crear la orden y cobrar, para evitar Race Conditions.
    for (const item of items) {
      // Usamos el RPC que descuenta SOLO SI HAY STOCK SUFICIENTE
      // Asumiendo que tu RPC decrement_stock hace: UPDATE products SET stock = stock - qty WHERE id = row_id AND stock >= qty
      const { data: decrementResult, error: stockError } = await serviceSupabase.rpc('decrement_stock', { qty: item.quantity, row_id: item.id })
      
      if (stockError || decrementResult === false) {
        // La función local devuelve false cuando otro checkout tomó el stock.
        const { data: current } = await supabase.from('products').select('stock, name').eq('id', item.id).single()
        
        if (!current || (current as any).stock < item.quantity) {
           console.error(`⛔ [Checkout] Stock insuficiente para ${(current as any)?.name || item.id}`)
           throw new Error(`Stock insuficiente para: ${(current as any)?.name || 'un producto'}`)
        } else {
           throw new Error(`No se pudo reservar stock para ${(current as any)?.name || 'un producto'}. Intenta nuevamente.`)
        }
      }
    }

    // 2. CREACIÓN DE LA ORDEN Y COBRO
    console.log('📝 [Server] Intentando insertar orden en DB...')
    const note = notes.length ? notes.join(' • ') : null

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        user_id: user.id,
        status: newStatus,
        total_amount: calculatedTotal,
        credits_used: Number(creditsApplied || 0),
        coupon_code: couponCode || null,
        discount_amount: Math.round(discountAmount * 100) / 100,
        delivery_notes: note,
        delivery_method: shippingDetails?.method || 'pickup',
        shipping_address: shippingDetails?.address || null,
        contact_name: contactDetails.name,
        contact_lastname: contactDetails.lastname,
        contact_phone: contactDetails.phone,
      })
      .select()
      .single()
    if (orderError) throw orderError
    console.log('✅ [Server] Orden creada con éxito.')

    const orderItemsData = resolvedItems.map((ri) => ({
      order_id: (order as any).id,
      product_id: ri.id,
      quantity: ri.quantity,
      price_at_purchase: ri.price_usd,
    }))
    const { error: itemsError } = await supabase.from('order_items').insert(orderItemsData)
    if (itemsError) throw itemsError

    try {
        console.log("📧 Iniciando envío de correos...")
        await sendOrderEmails(
            (order as any).id,
            (user as any).email,
            resolvedItems,
            calculatedTotal
        )
    } catch (mailError) {
        console.error("⚠️ La orden se creó pero falló el envío de mail:", mailError)
    }

    return { success: true, orderId: (order as any).id }
  } catch (error: any) {
    console.error('💥 [Server] EXCEPCIÓN FATAL:', error)
    return { success: false, error: error.message }
  }
}
