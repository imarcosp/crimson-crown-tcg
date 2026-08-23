"use client"
import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCartStore } from '@/store/cartStore'

export default function CartSync() {
  const { items } = useCartStore()
  const supabase = createClient()
  const isFirstMount = useRef(true)
  const userIdRef = useRef<string | null>(null)

  // Rehydrate only after the first client render. This keeps the server and
  // initial browser snapshots identical even when a previous session left
  // items in localStorage.
  useEffect(() => {
    void useCartStore.persist.rehydrate()
  }, [])

  useEffect(() => {
    const syncDown = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      userIdRef.current = user.id
      const { data: cloudItems } = await supabase.from('cart_items').select('*').eq('user_id', user.id)
      if (cloudItems && cloudItems.length > 0) {
        const productIds = cloudItems.map((i: any) => i.product_id)
        const { data: products } = await supabase.from('products').select('*').in('id', productIds)
        if (products) {
          const mapped = cloudItems.map((ci: any) => {
            const p = products.find((x: any) => x.id === ci.product_id)
            const qty = Math.min(Number(ci.quantity || 0), Number(p?.stock || 0))
            return p && qty > 0 ? {
              id: p.id,
              name: p.name,
              price: Number(p.price_usd || 0),
              quantity: qty,
              image: p.image_url || '',
              maxStock: Number(p.stock || 0),
              setName: p.set_name,
              condition: p.condition,
            } : null
          }).filter(Boolean) as any[]
          useCartStore.setState({ items: mapped })

          // Limpiar en DB los items sin stock
          const outOfStockIds = cloudItems
            .filter((ci: any) => {
              const p = products.find((x: any) => x.id === ci.product_id)
              return !p || Number(p.stock || 0) <= 0
            })
            .map((ci: any) => ci.product_id)
          if (outOfStockIds.length) {
            await supabase.from('cart_items').delete().in('product_id', outOfStockIds).eq('user_id', user.id)
          }
        }
      }
    }
    syncDown()
  }, [supabase])

  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false
      return
    }
    const timer = setTimeout(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      await supabase.from('cart_items').delete().eq('user_id', user.id)
      if (items.length > 0) {
        const payload = items.map((i) => ({ user_id: user.id, product_id: i.id, quantity: i.quantity }))
        await supabase.from('cart_items').insert(payload)
      }
    }, 1000)
    return () => clearTimeout(timer)
  }, [items, supabase])

  useEffect(() => {
    const subscribeRealtime = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      const uid = user?.id || userIdRef.current
      if (!uid) return
      const channel = supabase
        .channel('cart-sync')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'cart_items', filter: `user_id=eq.${uid}` }, async () => {
          const { data: cloudItems } = await supabase.from('cart_items').select('*').eq('user_id', uid)
          if (!cloudItems) { useCartStore.setState({ items: [] }); return }
          const productIds = cloudItems.map((i: any) => i.product_id)
          const { data: products } = await supabase.from('products').select('*').in('id', productIds)
          if (!products) return
          const mapped = cloudItems.map((ci: any) => {
            const p = products.find((x: any) => x.id === ci.product_id)
            const qty = Math.min(Number(ci.quantity || 0), Number(p?.stock || 0))
            return p && qty > 0 ? {
              id: p.id,
              name: p.name,
              price: Number(p.price_usd || 0),
              quantity: qty,
              image: p.image_url || '',
              maxStock: Number(p.stock || 0),
              setName: p.set_name,
              condition: p.condition,
            } : null
          }).filter(Boolean) as any[]
          useCartStore.setState({ items: mapped })
        })
        .subscribe()
      return () => { supabase.removeChannel(channel) }
    }
    subscribeRealtime()
  }, [supabase])

  return null
}
