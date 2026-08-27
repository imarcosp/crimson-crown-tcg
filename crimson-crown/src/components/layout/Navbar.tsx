"use client"
import Link from 'next/link'
import Image from 'next/image'
import { useStore } from '@/store/useStore'
import { useCartStore } from '@/store/cartStore'
import { ClipboardList, User, ShoppingCart, Menu as MenuIcon, Package, LogOut, Banknote, MessageSquarePlus, Send, X, Loader2, ChevronDown, Search, BookOpen, Sparkles, Zap, Plane, Box, Layers } from 'lucide-react'
import { useUIStore } from '@/store/uiStore'
import { cn } from '@/lib/utils'
import SearchInput from './SearchInput'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useConfig } from '@/context/ConfigContext'
import { ADMIN_EMAILS } from '@/lib/constants'
import NotificationsMenu from './NotificationsMenu'
import { siteConfig } from '@/config/site'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'

type MenuCategory = {
  category: string
  subcategories: string[]
}

export default function Navbar() {
  const currency = useStore((s) => s.currency)
  const { exchangeRate, enableImports, nextJapanTripDate } = useConfig()
  
  // Estados de Menús
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isMegaMenuOpen, setIsMegaMenuOpen] = useState(false)
  const [isMobileUserMenuOpen, setIsMobileUserMenuOpen] = useState(false)
  
  // Estados de los submenús del Sidebar
  const [isMtgOpen, setIsMtgOpen] = useState(false)
  const [isSealedOpen, setIsSealedOpen] = useState(false)
  const [menuCategories, setMenuCategories] = useState<MenuCategory[]>([])
  const [openDynamicCategories, setOpenDynamicCategories] = useState<Record<string, boolean>>({})

  const toggleCart = useUIStore((s) => s.toggleCart)
  const toggleHangModal = useUIStore((s) => s.toggleHangModal)
  const [user, setUser] = useState<any | null>(null)
  const router = useRouter()
  const supabase = createClient()
  const [credits, setCredits] = useState<number>(0)
  const [userProfile, setUserProfile] = useState<any>(null)
  const lastUserId = useRef<string | null>(null)
  const pathname = usePathname()
  const [nextTripCountdown, setNextTripCountdown] = useState<string>('')

  // ESTADOS FEEDBACK
  const [showFeedback, setShowFeedback] = useState(false)
  const [feedbackText, setFeedbackText] = useState('')
  const [sendingFeedback, setSendingFeedback] = useState(false)

  const cartItems = useCartStore((s) => s.items)
  const cartCount = cartItems.reduce((acc, item) => acc + item.quantity, 0)

  const fetchUserData = useCallback(async (userId: string) => {
    if (lastUserId.current === userId && userProfile) return
    lastUserId.current = userId
    const { data } = await supabase.from('profiles').select('credits, first_name, last_name').eq('id', userId).single()
    if (data) {
      setUserProfile(data)
      if (data.credits != null) setCredits(Number(data.credits))
    }
  }, [supabase, userProfile])

  useEffect(() => {
    let mounted = true
    const initSession = async () => {
      const { data: { session } } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }))
      if (mounted && session?.user) {
        setUser(session.user)
        fetchUserData(session.user.id)
      }
    }
    initSession()
    const intervalId = setInterval(() => { if (user?.id) fetchUserData(user.id) }, 30000)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event: AuthChangeEvent, session: Session | null) => {
      if (!mounted) return
      if (session?.user) {
        setUser(session.user)
        if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || !userProfile) fetchUserData(session.user.id)
      } else if (event === 'SIGNED_OUT') {
        setUser(null); setUserProfile(null); setCredits(0); lastUserId.current = null; router.replace('/')
      }
    })
    return () => { mounted = false; subscription.unsubscribe(); clearInterval(intervalId) }
  }, [supabase, fetchUserData, router, user?.id, userProfile]) 

  useEffect(() => {
    if (!user?.id) return
    const channel = supabase.channel('realtime-credits').on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${user.id}` }, (payload: any) => {
          if (payload?.new) { setCredits(Number(payload.new.credits || 0)); setUserProfile((prev: any) => ({ ...prev, ...payload.new })) }
    }).subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [user?.id, supabase])

  useEffect(() => { 
      setIsMenuOpen(false)
      setIsMegaMenuOpen(false)
      setIsMobileUserMenuOpen(false)
  }, [pathname])

  useEffect(() => {
    if (enableImports || !nextJapanTripDate) {
      setNextTripCountdown('')
      return
    }

    const computeCountdown = () => {
      const target = new Date(`${nextJapanTripDate}T00:00:00`)
      const diff = target.getTime() - Date.now()

      if (Number.isNaN(target.getTime()) || diff <= 0) {
        setNextTripCountdown('')
        return
      }

      const totalSeconds = Math.floor(diff / 1000)
      const totalHours = Math.floor(totalSeconds / 3600)
      const hoursPerDay = 24
      const hoursPerWeek = 7 * hoursPerDay
      const hoursPerMonth = 30 * hoursPerDay

      let remainingHours = totalHours
      const months = Math.floor(remainingHours / hoursPerMonth)
      remainingHours -= months * hoursPerMonth

      const weeks = Math.floor(remainingHours / hoursPerWeek)
      remainingHours -= weeks * hoursPerWeek

      const days = Math.floor(remainingHours / hoursPerDay)
      remainingHours -= days * hoursPerDay

      const hours = remainingHours

      const parts: string[] = []
      if (months > 0) parts.push(`${months} mes${months === 1 ? '' : 'es'}`)
      if (weeks > 0 || months > 0) parts.push(`${weeks} semana${weeks === 1 ? '' : 's'}`)
      if (days > 0 || weeks > 0 || months > 0) parts.push(`${days} día${days === 1 ? '' : 's'}`)
      parts.push(`${hours} hora${hours === 1 ? '' : 's'}`)

      setNextTripCountdown(parts.join(', '))
    }

    computeCountdown()
    const intervalId = window.setInterval(computeCountdown, 1000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [enableImports, nextJapanTripDate])

  useEffect(() => {
    let mounted = true

    const loadMenuCategories = async () => {
      try {
        let from = 0
        const PAGE_SIZE = 1000
        let keepLoading = true
        const categoryMap = new Map<string, Set<string>>()
        const { data: activeInventories } = await supabase
          .from('inventories')
          .select('id')
          .eq('is_active', true)
          .is('archived_at', null)
        const activeInventoryIds = (activeInventories || []).map((inventory: any) => String(inventory.id))

        while (keepLoading) {
          const { data, error } = await supabase
            .from('products')
            .select('tcg, metadata, name')
            .in('inventory_id', activeInventoryIds)
            .gt('stock', 0)
            .not('name', 'ilike', '%(ARCHIVADO)%')
            .range(from, from + PAGE_SIZE - 1)

          if (error) throw error

          const rows = Array.isArray(data) ? data : []
          rows.forEach((row: any) => {
            const category = String(row?.tcg || '').trim()
            if (!category) return

            if (!categoryMap.has(category)) {
              categoryMap.set(category, new Set<string>())
            }

            const subcategory = String(row?.metadata?.subcategory || '').trim()
            if (subcategory) {
              categoryMap.get(category)?.add(subcategory)
            }
          })

          if (rows.length < PAGE_SIZE) keepLoading = false
          else from += PAGE_SIZE
        }

        if (!mounted) return

        const nextMenu = Array.from(categoryMap.entries())
          .map(([category, subcategories]) => ({
            category,
            subcategories: Array.from(subcategories).sort((a, b) => a.localeCompare(b)),
          }))
          .sort((a, b) => a.category.localeCompare(b.category))

        setMenuCategories(nextMenu)
      } catch (error) {
        console.error('Error cargando categorías del menú:', error)
      }
    }

    loadMenuCategories()

    return () => {
      mounted = false
    }
  }, [supabase])

  const handleLogout = async () => { await supabase.auth.signOut(); router.refresh(); router.replace('/') }

  const openFeedback = () => { 
      setIsMenuOpen(false)
      setIsMegaMenuOpen(false)
      setIsMobileUserMenuOpen(false)
      setShowFeedback(true) 
  }

  const submitFeedback = async () => {
      if (!feedbackText.trim()) return
      setSendingFeedback(true)
      try {
          // NOTA: Asegúrate de que la columna 'message' exista en la tabla 'feedback' de tu BD Supabase.
          const { error } = await supabase.from('feedback').insert({ user_id: user?.id, message: feedbackText.trim() })
          if (error) throw error
          alert('¡Gracias por tu sugerencia! La revisaremos pronto.')
          setFeedbackText(''); setShowFeedback(false)
      } catch (e: any) { alert('Error al enviar: ' + e.message) } 
      finally { setSendingFeedback(false) }
  }

  const closeMenus = () => { 
      setIsMegaMenuOpen(false)
      setIsMenuOpen(false)
      setIsMobileUserMenuOpen(false)
  }

  const buildCatalogHref = (category: string, subcategory?: string) => {
    const params = new URLSearchParams({ tcg: category, sort: 'newest' })
    if (subcategory) params.set('subcategory', subcategory)
    return `/catalog?${params.toString()}`
  }

  const toggleDynamicCategory = (category: string) => {
    setOpenDynamicCategories((prev) => ({ ...prev, [category]: !prev[category] }))
  }

  const hasMenuCategory = (category: string) => menuCategories.some((entry) => entry.category === category)
  const magicMenu = menuCategories.find((entry) => entry.category === 'Magic') || null
  const dynamicCategories = menuCategories.filter((entry) => {
    if (['Magic', 'Riftbound', 'Secret Lair'].includes(entry.category)) return false
    return true
  })

  const SidebarContent = () => (
      <div className="flex flex-col h-full text-slate-800 bg-white shadow-2xl border-r border-slate-200">
          <div className="p-4 border-b flex items-center justify-between bg-slate-50">
              <span className="font-bold text-lg flex items-center gap-2 text-slate-800"><MenuIcon size={20}/> Navegación</span>
              <button onClick={closeMenus} className="p-2 hover:bg-slate-200 rounded-full cursor-pointer transition-colors"><X size={20}/></button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {magicMenu && (
                <>
                  <button onClick={() => setIsMtgOpen(!isMtgOpen)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-100 rounded-lg font-bold text-sm text-slate-700 group cursor-pointer transition-colors">
                      <div className="flex items-center gap-3"><Sparkles className="text-purple-600" size={18}/> Magic: The Gathering</div>
                      <ChevronDown size={16} className={`transition-transform duration-300 ${isMtgOpen ? 'rotate-180' : ''}`}/>
                  </button>
                  {isMtgOpen && (
                      <div className="pl-12 pr-4 space-y-1 pb-2 animate-in slide-in-from-top-2 duration-300 ease-out">
                          <Link href={buildCatalogHref('Magic')} onClick={closeMenus} className="block py-2 text-sm text-slate-500 hover:text-[#9D1B1B] font-medium border-l-2 border-slate-200 pl-3 hover:border-[#9D1B1B] transition-colors cursor-pointer">
                              Ver todo Magic
                          </Link>
                          {magicMenu.subcategories.map((subcategory) => (
                            <Link key={subcategory} href={buildCatalogHref('Magic', subcategory)} onClick={closeMenus} className="block py-2 text-sm text-slate-500 hover:text-[#9D1B1B] font-medium border-l-2 border-slate-200 pl-3 hover:border-[#9D1B1B] transition-colors cursor-pointer">
                                {subcategory}
                            </Link>
                          ))}
                          <Link href="/tools/moxfield" onClick={closeMenus} className="block py-2 text-sm text-slate-500 hover:text-[#9D1B1B] font-medium border-l-2 border-slate-200 pl-3 hover:border-[#9D1B1B] transition-colors cursor-pointer">
                              Búsqueda desde Moxfield
                          </Link>
                      </div>
                  )}
                </>
              )}
              {siteConfig.features?.showRiftbound && hasMenuCategory('Riftbound') && (
                <Link href={buildCatalogHref('Riftbound')} onClick={closeMenus} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-100 rounded-lg font-bold text-sm text-slate-700 transition-colors cursor-pointer">
                    <Zap className="text-yellow-500" size={18}/> Riftbound
                </Link>
              )}
              {siteConfig.features?.showSecretLair && hasMenuCategory('Secret Lair') && (
                <Link href={buildCatalogHref('Secret Lair')} onClick={closeMenus} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-100 rounded-lg font-bold text-sm text-slate-700 transition-colors cursor-pointer">
                    <Box className="text-[#9D1B1B]" size={18}/> Secret Lair
                </Link>
              )}
              {enableImports && (
                <>
                  <div className="border-t my-2 mx-4 border-slate-100"></div>
                  <button 
                      onClick={() => { closeMenus(); toggleHangModal() }} 
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-100 rounded-lg font-bold text-sm text-slate-700 transition-colors text-left cursor-pointer group"
                  >
                      <Plane className="text-[#9D1B1B] group-hover:scale-110 transition-transform" size={18}/> 
                      Pedido a Japón
                  </button>
                </>
              )}
              {dynamicCategories.length > 0 && <div className="border-t my-2 mx-4 border-slate-100"></div>}
              {dynamicCategories.map((entry) => {
                const isOpen = !!openDynamicCategories[entry.category]
                const hasSubcategories = entry.subcategories.length > 0

                if (!hasSubcategories) {
                  return (
                    <Link key={entry.category} href={buildCatalogHref(entry.category)} onClick={closeMenus} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-100 rounded-lg font-bold text-sm text-slate-700 transition-colors cursor-pointer">
                        <Package className="text-blue-500" size={18}/> {entry.category}
                    </Link>
                  )
                }

                return (
                  <div key={entry.category}>
                    <button onClick={() => toggleDynamicCategory(entry.category)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-100 rounded-lg font-bold text-sm text-slate-700 group cursor-pointer transition-colors">
                        <div className="flex items-center gap-3"><Package className="text-blue-500" size={18}/> {entry.category}</div>
                        <ChevronDown size={16} className={`transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}/>
                    </button>
                    {isOpen && (
                      <div className="pl-12 pr-4 space-y-1 pb-2 animate-in slide-in-from-top-2 duration-300 ease-out">
                          <Link href={buildCatalogHref(entry.category)} onClick={closeMenus} className="block py-2 text-sm text-slate-500 hover:text-[#9D1B1B] font-medium border-l-2 border-slate-200 pl-3 hover:border-[#9D1B1B] transition-colors cursor-pointer">
                              Ver todo {entry.category}
                          </Link>
                          {entry.subcategories.map((subcategory) => (
                            <Link key={subcategory} href={buildCatalogHref(entry.category, subcategory)} onClick={closeMenus} className="block py-2 text-sm text-slate-500 hover:text-[#9D1B1B] font-medium border-l-2 border-slate-200 pl-3 hover:border-[#9D1B1B] transition-colors cursor-pointer">
                                {subcategory}
                            </Link>
                          ))}
                      </div>
                    )}
                  </div>
                )
              })}
              <div className="border-t my-2 mx-4 border-slate-100"></div>
              <Link href="/info/how-to" onClick={closeMenus} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-100 rounded-lg font-medium text-sm text-slate-600 transition-colors cursor-pointer">
                  <BookOpen size={18}/> Cómo usar {siteConfig.shortName}
              </Link>
              <div className="border-t my-2 mx-4 border-slate-100"></div>
              <Link href="/sell" onClick={closeMenus} className="flex items-center gap-3 px-4 py-3 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg font-bold text-sm transition-colors cursor-pointer">
                  <Banknote size={18}/> Véndenos tus cartas
              </Link>
          </div>
      </div>
  )

  return (
    <>
    <nav className="bg-[#1C1B22] text-white sticky top-0 z-50 shadow-md">
      <div className="mx-auto max-w-7xl px-4 py-3">
        <div className="flex flex-col md:flex-row">
          
          {/* ======================= MÓVIL ======================= */}
          <div className="flex justify-between items-center w-full md:hidden relative">
            <div className="flex items-center gap-2">
                <button onClick={() => setIsMenuOpen(true)} className="p-2 rounded hover:bg-slate-700 cursor-pointer transition-colors"><MenuIcon className="h-6 w-6" /></button>
                <Link href="/" className="flex items-center gap-2 cursor-pointer hover:opacity-90 transition-opacity">
                    <div className="relative w-8 h-8 rounded-full overflow-hidden border border-white/20"><Image src={siteConfig.logo} alt={siteConfig.shortName} fill sizes="32px" className="object-cover" /></div>
                    <span className="font-extrabold text-sm hidden xs:block">{siteConfig.shortName.toUpperCase()}</span>
                </Link>
            </div>
            
            <div className="flex items-center gap-2">
              
              {/* BLOQUE COTIZACIÓN MÓVIL (CORREGIDO: CENTRADO) */}
              <div className="flex flex-col items-center justify-center mr-1">
                  <span className="text-[9px] text-slate-400 font-bold uppercase leading-none mb-0.5 tracking-tight">Cotización Dólar</span>
                  <div className="flex items-center gap-1 bg-slate-800/80 rounded-md p-0.5 border border-slate-700">
                      <div className="text-[10px] font-bold text-emerald-400 px-1.5">${exchangeRate}</div>
                      <div className="flex gap-0.5">
                        <button onClick={() => useStore.getState().setCurrency('USD')} className={cn('cursor-pointer transition-colors py-0.5 px-1.5 text-[9px] font-bold', currency === 'USD' ? 'bg-[#9D1B1B] text-white rounded' : 'text-slate-400 hover:text-white')}>USD</button>
                        <button onClick={() => useStore.getState().setCurrency('ARS')} className={cn('cursor-pointer transition-colors py-0.5 px-1.5 text-[9px] font-bold', currency === 'ARS' ? 'bg-[#9D1B1B] text-white rounded' : 'text-slate-400 hover:text-white')}>ARS</button>
                      </div>
                  </div>
              </div>

              {/* PERFIL MÓVIL */}
              <div className="relative">
                  <button onClick={() => setIsMobileUserMenuOpen(!isMobileUserMenuOpen)} className="p-1.5 rounded hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"><User size={20} /></button>
                  {isMobileUserMenuOpen && (
                    <>
                        <div className="fixed inset-0 z-[65] bg-transparent" onClick={() => setIsMobileUserMenuOpen(false)}></div>
                        <div className="absolute right-0 top-full mt-2 w-56 bg-white text-slate-800 rounded-xl shadow-xl border border-slate-100 p-2 z-[70] animate-in zoom-in-95 fade-in duration-200 origin-top-right">
                            {!user ? (
                                <div className="space-y-2 p-1">
                                    <p className="text-xs text-center text-slate-400 mb-2">Accede para ver tus compras</p>
                                    <Link href="/login" onClick={closeMenus} className="block w-full text-center bg-[#9D1B1B] text-white py-2 rounded-lg text-sm font-bold hover:bg-[#7E1515] transition-colors">Iniciar Sesión</Link>
                                    <Link href="/login?view=signup" onClick={closeMenus} className="block w-full text-center border border-slate-300 py-2 rounded-lg text-sm font-bold hover:bg-slate-50 transition-colors">Registrarse</Link>
                                </div>
                            ) : (
                                <>
                                    <div className="p-3 border-b border-slate-100 mb-2 bg-slate-50 rounded-t-lg">
                                        <p className="font-bold truncate text-sm">Hola, {userProfile?.first_name || 'Viajero'}</p>
                    <p className="text-xs text-[#9D1B1B] font-mono font-bold mt-1">{currency === 'ARS' ? `Créditos: $${(credits * exchangeRate).toLocaleString()}` : `Créditos: US$ ${credits.toFixed(2)}`}</p>
                                    </div>
                                    <div className="space-y-1">
                                        {user?.email && ADMIN_EMAILS.includes(user.email) && <Link href="/admin" onClick={closeMenus} className="flex items-center gap-3 px-3 py-2 bg-slate-900 text-yellow-500 hover:bg-slate-800 rounded-lg text-sm font-bold mb-2 transition-colors"><span className="text-lg">🛡️</span> Panel de Admin</Link>}
                                        <Link href="/sell" onClick={closeMenus} className="flex items-center gap-3 px-3 py-2 hover:bg-red-50 hover:text-[#9D1B1B] rounded-lg text-sm transition-colors group"><Banknote size={16} className="text-slate-400 group-hover:text-[#9D1B1B]"/> Vender Cartas</Link>
                                        <Link href="/profile" onClick={closeMenus} className="flex items-center gap-3 px-3 py-2 hover:bg-red-50 hover:text-[#9D1B1B] rounded-lg text-sm transition-colors group"><User size={16} className="text-slate-400 group-hover:text-[#9D1B1B]"/> Mi Cuenta</Link>
                                        <Link href="/profile?tab=stock" onClick={closeMenus} className="flex items-center gap-3 px-3 py-2 hover:bg-red-50 hover:text-[#9D1B1B] rounded-lg text-sm transition-colors group"><Package size={16} className="text-slate-400 group-hover:text-[#9D1B1B]"/> Mis Pedidos</Link>
                                        <button onClick={openFeedback} className="w-full flex items-center gap-3 px-3 py-2 hover:bg-red-50 hover:text-[#9D1B1B] text-sky-600 rounded-lg text-sm transition-colors text-left group"><MessageSquarePlus size={16} className="group-hover:text-[#9D1B1B]" /> Dejar Sugerencia</button>
                                    </div>
                                    <div className="border-t border-slate-100 mt-2 pt-2">
                                        <button onClick={() => {handleLogout(); closeMenus()}} className="w-full text-left px-3 py-2 hover:bg-red-50 text-red-600 rounded-lg flex items-center gap-3 text-sm transition-colors"><LogOut size={16}/> Cerrar Sesión</button>
                                    </div>
                                </>
                            )}
                        </div>
                    </>
                  )}
              </div>

              {user && <NotificationsMenu userId={user.id} />}
              <button onClick={toggleCart} className="relative p-1.5 rounded hover:bg-slate-700 cursor-pointer transition-colors"><ShoppingCart className="h-5 w-5" />{cartCount > 0 && <span className="absolute -top-1 -right-1 bg-[#9D1B1B] text-white text-[10px] font-bold h-4 w-4 flex items-center justify-center rounded-full">{cartCount > 99 ? '99+' : cartCount}</span>}</button>
            </div>

            {/* DRAWER LATERAL (HAMBURGUESA) */}
            <>
                <div
                  className={`ui-overlay-soft fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm ${isMenuOpen ? 'opacity-100 visible pointer-events-auto' : 'opacity-0 invisible pointer-events-none'}`}
                  onClick={closeMenus}
                ></div>
                <div
                  className={`ui-drawer-left-soft fixed inset-y-0 left-0 z-[61] w-4/5 max-w-xs bg-white shadow-2xl flex flex-col border-r border-slate-200 ${isMenuOpen ? 'is-open pointer-events-auto' : 'is-closed pointer-events-none'}`}
                >
                    <div className="flex-1 overflow-hidden h-full">
                        <SidebarContent />
                    </div>
                </div>
            </>
          </div>

          {/* ======================= DESKTOP ======================= */}
          <div className="hidden md:flex items-center justify-between gap-3 w-full">
            <Link href="/" className="flex items-center gap-3 shrink-0 hover:opacity-90 transition-opacity cursor-pointer">
                <div className="relative w-10 h-10 rounded-full overflow-hidden border-2 border-white/20"><Image src={siteConfig.logo} alt={siteConfig.shortName} fill sizes="40px" className="object-cover" /></div>
                <span className="font-extrabold text-lg tracking-tight">{siteConfig.shortName.toUpperCase()}</span>
            </Link>

            <div className="flex-[1.35] flex items-center gap-2 mx-3 lg:mx-5 min-w-0">
                <button onClick={() => setIsMegaMenuOpen(true)} className="p-2 hover:bg-slate-800 rounded-lg text-slate-300 hover:text-white transition-colors cursor-pointer shrink-0 border border-transparent hover:border-slate-600" title="Menú Principal">
                    <MenuIcon size={24}/>
                </button>
                <div className="flex-1"><SearchInput /></div>
            </div>
            
            <div className="flex items-center gap-3 shrink-0">
              {/* BLOQUE COTIZACIÓN DESKTOP (CENTRALIZADO) */}
              <div className="flex flex-col items-center justify-center">
                  <span className="text-[10px] text-slate-400 font-bold uppercase leading-none mb-0.5 tracking-tight">Cotización Dólar</span>
                  <div className="flex items-center gap-1 bg-slate-800 rounded-md p-0.5 border border-slate-700">
                      <div className="text-[11px] font-bold text-emerald-400 px-1.5 cursor-default">${exchangeRate}</div>
                      <div className="flex gap-0.5">
                        <button onClick={() => useStore.getState().setCurrency('USD')} className={cn('cursor-pointer transition-colors py-0.5 px-1.5 text-[10px] font-bold', currency === 'USD' ? 'bg-[#9D1B1B] text-white rounded' : 'text-slate-400 hover:text-white')}>USD</button>
                        <button onClick={() => useStore.getState().setCurrency('ARS')} className={cn('cursor-pointer transition-colors py-0.5 px-1.5 text-[10px] font-bold', currency === 'ARS' ? 'bg-[#9D1B1B] text-white rounded' : 'text-slate-400 hover:text-white')}>ARS</button>
                      </div>
                  </div>
              </div>

              {user && <NotificationsMenu userId={user.id} />}

              <button onClick={toggleCart} className="relative p-2 rounded hover:bg-slate-700 cursor-pointer transition-colors"><ShoppingCart className="h-6 w-6" />{cartCount > 0 && <span className="absolute -top-1 -right-1 bg-[#9D1B1B] text-white text-[10px] font-bold h-5 w-5 flex items-center justify-center rounded-full shadow-sm">{cartCount > 99 ? '99+' : cartCount}</span>}</button>
              
              {enableImports ? (
                <Link href="/hang" className="bg-[#9D1B1B] hover:bg-[#7E1515] text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-colors cursor-pointer" onClick={(e) => { e.preventDefault(); toggleHangModal() }}>
                  <ClipboardList className="h-6 w-6" /> Pedido a Japón
                </Link>
              ) : nextTripCountdown ? (
                <div className="px-3 py-1.5 rounded-lg flex items-center gap-2 border border-[#9D1B1B]/35 bg-[#9D1B1B]/10 text-white max-w-[240px] lg:max-w-[270px]">
                  <Plane className="h-4 w-4 text-[#C7A316] shrink-0" />
                  <div className="flex flex-col leading-tight min-w-0">
                    <span className="text-[9px] uppercase tracking-wide text-slate-300 truncate">Próximo viaje a Japón</span>
                    <span className="text-xs lg:text-sm font-extrabold text-white truncate">{nextTripCountdown}</span>
                  </div>
                </div>
              ) : null}
              
              <div className="relative group z-50">
                <button className="flex items-center gap-2 hover:text-[#9D1B1B] py-2 cursor-pointer transition-colors">
                  <User size={24} />
                  <span className="text-sm font-medium">{user ? (userProfile?.first_name || 'Mi Cuenta') : 'Ingresar'}</span>
                </button>
                <div className="absolute right-0 top-full mt-0 w-64 bg-white text-slate-800 rounded-xl shadow-xl border border-slate-100 opacity-0 invisible translate-y-2 scale-[0.98] group-hover:opacity-100 group-hover:visible group-hover:translate-y-0 group-hover:scale-100 transition-all duration-200 ease-out p-2 z-50">
                  {!user ? (
                    <div className="p-2 space-y-2">
                      <p className="text-xs text-center text-slate-400 mb-2">Accede para ver tus compras</p>
                      <Link href="/login" className="block w-full text-center bg-[#9D1B1B] text-white py-2 rounded-lg font-bold hover:bg-[#7E1515] transition-colors cursor-pointer">Iniciar Sesión</Link>
                      <Link href="/login?view=signup" className="block w-full text-center border border-slate-300 py-2 rounded-lg font-bold hover:bg-slate-50 transition-colors cursor-pointer">Registrarse</Link>
                    </div>
                  ) : (
                    <>
                      <div className="p-3 border-b border-slate-100 mb-2 bg-slate-50 rounded-t-lg">
                        <p className="font-bold truncate text-sm">Hola, {userProfile?.first_name || 'Viajero'}</p>
                        <p className="text-xs text-[#9D1B1B] font-mono font-bold mt-1">{currency === 'ARS' ? `Créditos: $${(credits * exchangeRate).toLocaleString()}` : `Créditos: US$ ${credits.toFixed(2)}`}</p>
                      </div>
                      <div className="space-y-1">
                        {user?.email && ADMIN_EMAILS.includes(user.email) && <Link href="/admin" className="flex items-center gap-3 px-3 py-2 bg-slate-900 text-yellow-500 hover:bg-slate-800 rounded-lg text-sm font-bold mb-2 transition-colors cursor-pointer"><span className="text-lg">🛡️</span> Panel de Admin</Link>}
                        <Link href="/sell" className="flex items-center gap-3 px-3 py-2 hover:bg-red-50 hover:text-[#9D1B1B] rounded-lg text-sm transition-colors cursor-pointer group"><Banknote size={16} className="text-slate-400 group-hover:text-[#9D1B1B]"/> Vender Cartas</Link>
                        <Link href="/profile" className="flex items-center gap-3 px-3 py-2 hover:bg-red-50 hover:text-[#9D1B1B] rounded-lg text-sm transition-colors cursor-pointer group"><User size={16} className="text-slate-400 group-hover:text-[#9D1B1B]"/> Mi Cuenta</Link>
                        <Link href="/profile?tab=stock" className="flex items-center gap-3 px-3 py-2 hover:bg-red-50 hover:text-[#9D1B1B] rounded-lg text-sm transition-colors cursor-pointer group"><Package size={16} className="text-slate-400 group-hover:text-[#9D1B1B]"/> Mis Pedidos</Link>
                        <button onClick={openFeedback} className="w-full flex items-center gap-3 px-3 py-2 hover:bg-red-50 hover:text-[#9D1B1B] text-sky-600 rounded-lg text-sm transition-colors text-left cursor-pointer group"><MessageSquarePlus size={16} className="group-hover:text-[#9D1B1B]" /> Dejar Sugerencia</button>
                      </div>
                      <div className="border-t border-slate-100 mt-2 pt-2">
                        <button onClick={handleLogout} className="w-full text-left px-3 py-2 hover:bg-red-50 text-red-600 rounded-lg flex items-center gap-3 text-sm transition-colors cursor-pointer"><LogOut size={16}/> Cerrar Sesión</button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="w-full mt-2 md:hidden"><SearchInput /></div>
        </div>
      </div>

      {/* DRAWER DESKTOP (MEGA MENU) */}
      <>
          <div
            className={`ui-overlay-soft fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm hidden md:block ${isMegaMenuOpen ? 'opacity-100 visible pointer-events-auto' : 'opacity-0 invisible pointer-events-none'}`}
            onClick={closeMenus}
          ></div>
          <div
            className={`ui-drawer-left-soft fixed inset-y-0 left-0 z-[61] w-80 bg-white shadow-2xl hidden md:block border-r border-slate-200 ${isMegaMenuOpen ? 'is-open pointer-events-auto' : 'is-closed pointer-events-none'}`}
          >
              <SidebarContent />
          </div>
      </>

      {/* FEEDBACK MODAL */}
      {showFeedback && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
              <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-6 relative animate-in zoom-in-95 fade-in duration-200">
                  <button onClick={() => setShowFeedback(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 cursor-pointer"><X size={20}/></button>
                  <h3 className="text-xl font-bold text-slate-800 mb-2 flex items-center gap-2"><MessageSquarePlus className="text-sky-500"/> Sugerencia</h3>
                  <p className="text-sm text-slate-500 mb-4">Ayúdanos a mejorar. Cuéntanos qué te gustaría ver en la web.</p>
                  <textarea className="w-full h-32 border border-slate-300 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none text-slate-900" placeholder="Escribe tu sugerencia aquí..." value={feedbackText} onChange={(e) => setFeedbackText(e.target.value)} />
                  <div className="flex justify-end gap-3 mt-4">
                      <button onClick={() => setShowFeedback(false)} className="px-4 py-2 text-slate-500 font-bold hover:bg-slate-100 rounded-lg cursor-pointer">Cancelar</button>
                      <button onClick={submitFeedback} disabled={sendingFeedback || !feedbackText.trim()} className="px-6 py-2 bg-sky-600 text-white font-bold rounded-lg hover:bg-sky-700 disabled:opacity-50 flex items-center gap-2 cursor-pointer">{sendingFeedback ? <Loader2 className="animate-spin" size={18}/> : <Send size={18}/>} Enviar</button>
                  </div>
              </div>
          </div>
      )}
    </nav>
    </>
  )
}
