"use client"
import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Bell, ExternalLink } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'

interface Notification {
  id: string
  title: string
  message: string
  link?: string
  is_read: boolean
  created_at: string
  type: 'order' | 'buylist' | 'stock' | 'credit' | 'system' | 'import'
}

export default function NotificationsMenu({ userId }: { userId: string }) {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const menuRef = useRef<HTMLDivElement>(null)
  
  const supabase = createClient()
  const router = useRouter()

  // Función de carga extraída para poder reusarla en el intervalo
  const fetchNotifs = useCallback(async () => {
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20)
    
    if (data) {
      setNotifications(data as Notification[])
      setUnreadCount(data.filter((n: any) => !n.is_read).length)
    }
    setLoading(false)
  }, [userId, supabase])

  // 1. Cargar Inicial + Polling (Intervalo de 30s)
  useEffect(() => {
    fetchNotifs() // Carga inmediata

    // Actualización automática cada 30 segundos (Fallback)
    const intervalId = setInterval(() => {
        fetchNotifs()
    }, 30000)

    return () => clearInterval(intervalId)
  }, [fetchNotifs])

  // 2. Suscripción Realtime (Intento de "En Vivo")
  useEffect(() => {
    const channel = supabase
      .channel('realtime-notifications')
      .on(
        'postgres_changes',
        { 
          event: 'INSERT', 
          schema: 'public', 
          table: 'notifications', 
          filter: `user_id=eq.${userId}` 
        },
        (payload) => {
          const newNotif = payload.new as Notification
          setNotifications((prev) => [newNotif, ...prev])
          setUnreadCount((prev) => prev + 1)
        }
      )
      .subscribe()

    return () => { 
      supabase.removeChannel(channel) 
    }
  }, [userId, supabase])

  // Cerrar al hacer click fuera
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleNotificationClick = async (notif: Notification) => {
    setIsOpen(false)

    if (!notif.is_read) {
        // Optimistic update
        setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, is_read: true } : n))
        setUnreadCount(prev => Math.max(0, prev - 1))
        await supabase.from('notifications').update({ is_read: true }).eq('id', notif.id)
    }

    if (notif.link) {
        router.push(notif.link)
    }
  }

  const markAllRead = async () => {
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
    setUnreadCount(0)
    await supabase.from('notifications').update({ is_read: true }).eq('user_id', userId)
  }

  const getIcon = (type: string) => {
    switch (type) {
        case 'order': return '📦';
        case 'buylist': return '💰';
        case 'credit': return '💳';
        case 'stock': return '🔥';
        case 'import': return '✈️';
        default: return '📢';
    }
  }

  return (
    <div className="relative" ref={menuRef}>
      <button 
        onClick={() => setIsOpen(!isOpen)} 
        className="relative p-2 rounded hover:bg-slate-700 cursor-pointer transition-colors"
        aria-label="Notificaciones"
      >
        <Bell className="h-6 w-6 text-slate-200" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 bg-[#E91E63] text-white text-[10px] font-bold h-4 w-4 flex items-center justify-center rounded-full shadow-sm animate-pulse">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 md:right-[-50px] top-full mt-2 w-80 md:w-96 bg-white rounded-xl shadow-2xl border border-slate-200 z-[100] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
          <div className="p-3 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
            <h3 className="font-bold text-slate-700 text-sm">Notificaciones</h3>
            {unreadCount > 0 && (
                <button onClick={markAllRead} className="text-xs text-[#E91E63] font-bold hover:underline cursor-pointer">
                    Marcar todo leído
                </button>
            )}
          </div>

          <div className="max-h-[400px] overflow-y-auto">
            {loading ? (
                <div className="p-8 text-center text-slate-400 text-xs">Cargando...</div>
            ) : notifications.length === 0 ? (
                <div className="p-8 text-center flex flex-col items-center gap-2 text-slate-400">
                    <Bell size={24} className="opacity-20"/>
                    <span className="text-xs">No tienes notificaciones nuevas</span>
                </div>
            ) : (
                <div className="divide-y divide-slate-50">
                    {notifications.map((notif) => (
                        <div 
                            key={notif.id} 
                            onClick={() => handleNotificationClick(notif)}
                            className={cn(
                                "p-4 hover:bg-slate-50 transition-colors cursor-pointer flex gap-3 items-start",
                                !notif.is_read ? "bg-sky-50/40" : ""
                            )}
                        >
                            <div className="text-xl shrink-0 select-none">{getIcon(notif.type)}</div>
                            <div className="flex-1 space-y-1">
                                <div className="flex justify-between items-start">
                                    <p className={cn("text-sm text-slate-800 leading-tight", !notif.is_read && "font-bold")}>
                                        {notif.title}
                                    </p>
                                    {!notif.is_read && <span className="h-2 w-2 rounded-full bg-[#E91E63] shrink-0 mt-1"></span>}
                                </div>
                                <p className="text-xs text-slate-500 line-clamp-2">{notif.message}</p>
                                <p className="text-[10px] text-slate-400 font-medium">
                                    {new Date(notif.created_at).toLocaleDateString()} • {new Date(notif.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                </p>
                                {notif.link && (
                                    <div className="inline-flex items-center gap-1 text-[10px] font-bold text-sky-600 mt-1 bg-sky-50 px-2 py-1 rounded">
                                        Ver Detalle <ExternalLink size={10}/>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}