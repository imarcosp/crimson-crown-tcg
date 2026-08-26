'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { Banknote, Package, CheckCircle, ArrowRight, X } from 'lucide-react'
import { usePathname } from 'next/navigation'

export default function ActiveImportsBanner() {
    const [orders, setOrders] = useState<any[]>([])
    // Eliminamos dismissedIds local, usaremos una función derivada de localStorage
    const [dismissedKeys, setDismissedKeys] = useState<string[]>([])
    const supabase = createClient()
    const pathname = usePathname()

    useEffect(() => {
        // Cargar los keys descartados desde localStorage al montar
        try {
            const stored = localStorage.getItem('perchero_dismissed_notifications')
            if (stored) {
                setDismissedKeys(JSON.parse(stored))
            }
        } catch (e) {}
    }, [])

    const markAsDismissed = (orderId: string, status: string) => {
        const key = `${orderId}_${status}`
        setDismissedKeys(prev => {
            const next = [...prev, key]
            try { localStorage.setItem('perchero_dismissed_notifications', JSON.stringify(next)) } catch(e){}
            return next
        })
    }

    const fetchActiveOrders = useCallback(async () => {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return

        const { data } = await supabase
            .from('import_orders')
            .select('id, order_number, status')
            .eq('user_id', session.user.id)
            .in('status', ['Cotizada', 'Parcialmente Disponible', 'Disponible'])
        
        if (data) {
            setOrders(data)
        }
    }, [supabase])

    useEffect(() => {
        fetchActiveOrders()
    }, [fetchActiveOrders])

    // Suscripción Realtime para detectar cambios de estado al instante
    useEffect(() => {
        const setupRealtime = async () => {
            const { data: { session } } = await supabase.auth.getSession()
            if (!session) return

            const channel = supabase
                .channel('import_orders_status_changes')
                .on(
                    'postgres_changes',
                    { 
                        event: 'UPDATE', 
                        schema: 'public', 
                        table: 'import_orders', 
                        filter: `user_id=eq.${session.user.id}` 
                    },
                    (payload: { new: { id: string; status: string } }) => {
                        const newStatus = payload.new.status
                        if (['Cotizada', 'Parcialmente Disponible', 'Disponible'].includes(newStatus)) {
                            // Re-fetch para asegurar que tenemos la data fresca
                            fetchActiveOrders()
                        } else {
                            // Si la orden pasó a un estado donde no hay notificación (ej. Completada, Procesada)
                            // la sacamos de la lista activa
                            setOrders(prev => prev.filter(o => o.id !== payload.new.id))
                        }
                    }
                )
                .subscribe()

            return () => {
                supabase.removeChannel(channel)
            }
        }
        setupRealtime()
    }, [supabase, fetchActiveOrders])

    // Marcar como leída automáticamente si el usuario visita la página de la orden
    useEffect(() => {
        if (pathname.startsWith('/profile/imports/')) {
            const currentOrderId = pathname.split('/').pop()
            if (currentOrderId) {
                const orderInView = orders.find(o => String(o.id) === currentOrderId)
                if (orderInView) {
                    const key = `${orderInView.id}_${orderInView.status}`
                    if (!dismissedKeys.includes(key)) {
                        markAsDismissed(orderInView.id, orderInView.status)
                    }
                }
            }
        }
    }, [pathname, orders, dismissedKeys])

    if (orders.length === 0) return null

    // Filtrar las que el usuario haya cerrado en esta sesión o guardado en localStorage, 
    // o aquellas cuya página de detalle esté siendo vista actualmente
    const visibleOrders = orders.filter(o => {
        const key = `${o.id}_${o.status}`
        const isDismissed = dismissedKeys.includes(key)
        const isCurrentlyViewing = pathname === `/profile/imports/${o.id}`
        
        return !isDismissed && !isCurrentlyViewing
    })

    if (visibleOrders.length === 0) return null

    // Mostramos solo la primera para no saturar la pantalla
    const order = visibleOrders[0]

    let icon = <CheckCircle className="text-white shrink-0" size={24}/>
    let bgColor = 'bg-emerald-600'
    let text = ''

    if (order.status === 'Cotizada') {
        icon = <Banknote className="text-white shrink-0" size={24}/>
        bgColor = 'bg-blue-600'
        text = `Tu orden de importación #${order.order_number} ya fue cotizada, haz click aquí para ir a ver tu orden.`
    } else if (order.status === 'Parcialmente Disponible') {
        icon = <Package className="text-white shrink-0" size={24}/>
        bgColor = 'bg-emerald-600'
        text = `Algunos ítems de tu orden #${order.order_number} ya están disponibles, haz click aquí para ver cuáles son.`
    } else if (order.status === 'Disponible') {
        icon = <CheckCircle className="text-white shrink-0" size={24}/>
        bgColor = 'bg-emerald-600'
        text = `¡Tu orden de importación #${order.order_number} ya está disponible! Haz click aquí para verla.`
    }

    return (
        <div className={`fixed bottom-4 left-4 right-4 md:left-auto md:right-8 md:w-[400px] z-50 animate-in slide-in-from-bottom-5 fade-in shadow-2xl rounded-xl p-4 flex gap-4 items-start ${bgColor} text-white`}>
            {icon}
            <div className="flex-1">
                <p className="font-bold text-sm leading-tight mb-2 pr-4">{text}</p>
                <Link 
                    href={`/profile/imports/${order.id}`} 
                    onClick={() => markAsDismissed(order.id, order.status)}
                    className="inline-flex items-center gap-1 text-xs font-bold bg-white/20 hover:bg-white/30 transition-colors px-3 py-1.5 rounded-lg"
                >
                    Ver mi orden <ArrowRight size={14}/>
                </Link>
            </div>
            <button 
                onClick={() => markAsDismissed(order.id, order.status)}
                className="absolute top-2 right-2 p-1 text-white/60 hover:text-white hover:bg-white/10 rounded-full transition-colors cursor-pointer"
            >
                <X size={16}/>
            </button>
        </div>
    )
}
