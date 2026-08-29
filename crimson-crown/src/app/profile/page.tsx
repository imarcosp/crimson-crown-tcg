"use client"
import { useEffect, useState, Suspense } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'
import { useStore } from '@/store/useStore'
import { useUIStore } from '@/store/uiStore'
import Link from 'next/link'
import { Package, Banknote, Clock, CheckCircle, AlertCircle, Truck, ExternalLink, UserCog, Plane, ChevronDown, ChevronUp, Send, X, Calendar, ChevronRight, Bell, Trash2, ZoomIn, CreditCard, Copy, MessageCircle, Loader2 } from 'lucide-react'
import ProfileSettings from '@/components/profile/ProfileSettings'
import { useContactWhatsapp } from '@/hooks/useContactWhatsapp'
import { buildWhatsAppUrl } from '@/lib/contact-whatsapp'
import { createUploadTicketAction, finalizeOrderProofAction } from '@/app/actions/storage-uploads'
import { uploadWithTicket } from '@/lib/storage/upload-client'
import { getPaymentProofUrlAction } from '@/app/actions/payment-proof-access'

function ProfileContent() {
  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const [orders, setOrders] = useState<any[]>([])
  const [buylists, setBuylists] = useState<any[]>([])
  const [importOrders, setImportOrders] = useState<any[]>([])
  const [wishlist, setWishlist] = useState<any[]>([])
  const [creditTxs, setCreditTxs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedBuylist, setExpandedBuylist] = useState<string | null>(null)
  
  // Estado para Zoom
  const [zoomedImage, setZoomedImage] = useState<string | null>(null)
  const [proofUrl, setProofUrl] = useState<string | null>(null)
  const [proofLoadingId, setProofLoadingId] = useState<string | null>(null)

  // Estados para Transferencia
  const [showTransferModal, setShowTransferModal] = useState(false)
  const [transferEmail, setTransferEmail] = useState('')
  const [transferAmount, setTransferAmount] = useState('')
  const [transferLoading, setTransferLoading] = useState(false)
  const [transferNote, setTransferNote] = useState('')

  // Estado para subida de comprobantes
  const [uploadingId, setUploadingId] = useState<string | null>(null)

  const searchParams = useSearchParams()
  const activeTab = searchParams.get('tab') || 'stock'
  const router = useRouter()
  const supabase = createClient()
  const currency = useStore((s) => s.currency)
  const rate = useStore((s) => s.usdToArsRate)
  const toggleHangModal = useUIStore((s) => s.toggleHangModal)
  const whatsapp = useContactWhatsapp()

  const fetchData = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }
    setUser(user)
    
    const { data: profileData } = await supabase.from('profiles').select('*').eq('id', user.id).single()
    setProfile(profileData)

    // Agregados campos de detalle al fetch de orders
    const { data: ordersData } = await supabase.from('orders')
        .select('id, created_at, total_amount, status, tracking_number, delivery_notes, payment_proof_url, payment_proof_path, order_items(*, products(*))')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
    setOrders(ordersData || [])
    
    const { data: importsData } = await supabase.from('import_orders').select('*').eq('user_id', user.id).order('created_at', { ascending: false })
    setImportOrders(importsData || [])

    const { data: buyData } = await supabase
      .from('buylist_orders')
      .select('id, created_at, status, total_offered, sent_at, created_by_admin_id, buylist_items(*)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    const buylistProductIds = (buyData || [])
      .flatMap((buylist: any) => Array.isArray(buylist?.buylist_items) ? buylist.buylist_items : [])
      .map((item: any) => String(item?.product_id || '').trim())
      .filter(Boolean)

    const { data: buyProducts } = buylistProductIds.length
      ? await supabase
          .from('products')
          .select('id, price_usd, price_usd_foil, finish, image_url, language')
          .in('id', buylistProductIds)
      : { data: [] as any[] }

    const buyProductMap = new Map((buyProducts || []).map((product: any) => [String(product.id), product]))
    const buyDataWithProducts = (buyData || []).map((buylist: any) => ({
      ...buylist,
      buylist_items: (Array.isArray(buylist?.buylist_items) ? buylist.buylist_items : []).map((item: any) => ({
        ...item,
        products: buyProductMap.get(String(item?.product_id || '')) || null,
      })),
    }))

    const visibleBuylists = (buyDataWithProducts || []).filter((buylist: any) => {
      if (String(buylist?.status || '').toLowerCase() === 'draft') return false
      if (buylist?.created_by_admin_id && !buylist?.sent_at) return false
      return true
    })
    setBuylists(visibleBuylists)
    
    const { data: txData } = await supabase.from('credit_transactions').select('*').eq('user_id', user.id).order('created_at', { ascending: false })
    setCreditTxs(txData || [])

    const { data: wishData } = await supabase.from('wishlists').select('*, products(finish)').eq('user_id', user.id).order('created_at', { ascending: false })
    setWishlist(wishData || [])
    
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [supabase, router])

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault()
    setTransferLoading(true)
    const amount = parseFloat(transferAmount)
    if (!transferEmail || isNaN(amount) || amount <= 0) {
        alert('Por favor ingresa un email válido y un monto mayor a 0.')
        setTransferLoading(false)
        return
    }
    const { error } = await supabase.rpc('transfer_credits', { recipient_email: transferEmail.trim(), amount: amount, note: transferNote.trim() })
    if (error) alert('Error: ' + error.message)
    else {
        alert('¡Transferencia exitosa!')
        setShowTransferModal(false)
        setTransferEmail('')
        setTransferAmount('')
        setTransferNote('')
        fetchData()
    }
    setTransferLoading(false)
  }

  const handleUploadProof = async (e: React.ChangeEvent<HTMLInputElement>, orderId: string) => {
      const file = e.target.files?.[0]
      if (!file) return

      if (file.size > 5 * 1024 * 1024) { // 5MB limit
          alert('El archivo es muy pesado (Máx 5MB).')
          return
      }

      setUploadingId(orderId)
      try {
          const uploadName = file.type === 'image/png'
              ? 'proof.png'
              : file.type === 'image/webp'
                ? 'proof.webp'
                : 'proof.jpg'
          const ticket = await createUploadTicketAction({
              kind: 'order-proof',
              recordId: orderId,
              name: uploadName,
              size: file.size,
              mimeType: file.type,
          })
          const uploaded = await uploadWithTicket(file, ticket)
          const result = await finalizeOrderProofAction(orderId, {
              bucket: uploaded.bucket,
              path: uploaded.path,
              name: uploadName,
              size: file.size,
              mimeType: file.type,
          })
          if (!result.success) throw new Error(result.error)
          
          // Actualizar estado local
          setOrders(prev => prev.map(o => o.id === orderId ? {
              ...o,
              status: 'verifying_payment',
              payment_proof_path: result.proofPath,
          } : o))

          alert('¡Comprobante subido! Lo revisaremos a la brevedad.')
      } catch (error: any) {
          alert('Error al subir: ' + error.message)
      } finally {
          setUploadingId(null)
      }
  }

  const handleViewProof = async (orderId: string) => {
      setProofLoadingId(orderId)
      try {
          const result = await getPaymentProofUrlAction({ domain: 'order', recordId: orderId })
          setProofUrl(result.url)
      } catch {
          alert('No se pudo abrir el comprobante. Intenta nuevamente.')
      } finally {
          setProofLoadingId(null)
      }
  }

  const formatDualPrice = (amountUsd: number) => {
      const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amountUsd)
      const ars = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(amountUsd * rate)
      return (
          <div className="flex flex-col items-end">
              <span>USD {usd}</span>
              <span className="text-[10px] text-slate-500 font-normal">ARS {ars}</span>
          </div>
      )
  }

  const formatMoney = (amountUsd: number) => {
    if (currency === 'ARS') return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(Number(amountUsd) * rate)
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(amountUsd))
  }

  const getQuoteItemProduct = (item: any) => {
    if (Array.isArray(item?.products)) return item.products[0] || null
    return item?.products || null
  }

  const getQuoteItemImage = (item: any) => {
    const product = getQuoteItemProduct(item)
    return item?.image_url || product?.image_url || null
  }

  const getQuoteItemMarketUnitPrice = (item: any) => {
    const product = getQuoteItemProduct(item)
    const normal = Number(product?.price_usd || 0)
    const foil = Number(product?.price_usd_foil || 0)
    if (Boolean(item?.is_foil)) return foil > 0 ? foil : normal
    return normal > 0 ? normal : foil
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending_payment': return <span className="bg-amber-100 text-amber-800 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1"><Clock size={12}/> Pendiente Pago</span>
      case 'verifying_payment': return <span className="bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1"><Clock size={12}/> Verificando Pago</span>
      case 'paid': return <span className="bg-emerald-100 text-emerald-800 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1"><CheckCircle size={12}/> Pagado</span>
      case 'processing': return <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1"><UserCog size={12}/> Procesando</span>
      case 'shipped': return <span className="bg-purple-100 text-purple-800 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1"><Truck size={12}/> Enviado</span>
      case 'completed': return <span className="bg-emerald-100 text-emerald-800 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1"><CheckCircle size={12}/> Completado</span>
      case 'cancelled': return <span className="bg-red-100 text-red-800 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1"><AlertCircle size={12}/> Cancelado</span>
      case 'refunded': return <span className="bg-orange-100 text-orange-800 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1"><AlertCircle size={12}/> Reembolsado</span>
      default: return <span className="bg-slate-100 text-slate-800 px-3 py-1 rounded-full text-xs font-bold">{status}</span>
    }
  }

  const getImportStatusColor = (s: string) => {
    switch(s) {
        case 'Iniciada': return 'bg-slate-100 text-slate-700'
        case 'Procesada': return 'bg-blue-100 text-blue-700'
        case 'Enviada': return 'bg-purple-100 text-purple-700'
        case 'Disponible': return 'bg-emerald-100 text-emerald-700'
        case 'Completada': return 'bg-green-100 text-green-800 border-green-200'
        default: return 'bg-slate-100 text-slate-600'
    }
  }

  const getBuylistBadge = (status: string) => {
    if (status === 'pending_review') return <span className="bg-amber-100 text-amber-800 px-3 py-1 rounded-full text-xs font-bold">En Revisión</span>
    if (status === 'draft') return <span className="bg-slate-100 text-slate-700 px-3 py-1 rounded-full text-xs font-bold">Borrador</span>
    if (status === 'waiting_user_approval') return <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-xs font-bold">Requiere tu Acción</span>
    if (status === 'completed') return <span className="bg-emerald-100 text-emerald-800 px-3 py-1 rounded-full text-xs font-bold">Acreditado</span>
    if (status === 'cancelled') return <span className="bg-red-100 text-red-800 px-3 py-1 rounded-full text-xs font-bold">Cancelada</span>
    if (status === 'rejected') return <span className="bg-red-100 text-red-800 px-3 py-1 rounded-full text-xs font-bold">Rechazada</span>
    return <span className="bg-slate-100 text-slate-800 px-3 py-1 rounded-full text-xs font-bold">{status}</span>
  }

  const handleAcceptOffer = async (buylistId: string) => {
      if(!confirm('¿Aceptar oferta? Si la recepción se valida, el monto se acreditará como créditos de tienda y podrás usarlos enseguida.')) return
      const { error } = await supabase.rpc('user_accept_buylist_offer', { buylist_id_input: buylistId })
      if (error) alert(error.message)
      else { alert('¡Oferta aceptada! Si la recepción se valida, el crédito quedará disponible en tu cuenta.'); await fetchData() }
  }

  const handleRejectOffer = async (buylistId: string) => {
      if(!confirm('¿Rechazar y cancelar solicitud?')) return
      const { error } = await supabase.from('buylist_orders').update({ status: 'cancelled' }).eq('id', buylistId)
      if (error) alert(error.message)
      else { alert('Solicitud cancelada.'); await fetchData() }
  }

  const removeFromWishlist = async (id: string) => {
      if(!confirm('¿Dejar de recibir alertas para esta carta?')) return
      await supabase.from('wishlists').delete().eq('id', id)
      setWishlist(prev => prev.filter(w => w.id !== id))
  }

  const isWishlistFoil = (item: any) => {
      const finish = item.products?.finish || ''
      return String(finish).toLowerCase().includes('foil') && !String(finish).toLowerCase().includes('non')
  }

  const renderFinishBadge = (finish: string) => {
    const f = (finish || '').toLowerCase()
    if (f.includes('foil') && !f.includes('non')) return <span className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded text-[10px] font-bold border border-purple-200">FOIL</span>
    if (f.includes('etched')) return <span className="bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded text-[10px] font-bold border border-amber-200">ETCHED</span>
    return null
  }

  const copyToClipboard = (text: string) => {
      navigator.clipboard.writeText(text)
      alert('Copiado al portapapeles: ' + text)
  }

  if (loading) return <div className="p-8 text-center">Cargando perfil...</div>
  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl relative">
      
      {/* ZOOM MODAL */}
      {zoomedImage && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 animate-in fade-in duration-200" onClick={() => setZoomedImage(null)}>
             <button className="absolute top-4 right-4 text-white/70 hover:text-white p-2 cursor-pointer z-50"><X size={32} /></button>
             <div className="relative w-full max-w-lg aspect-[3/4]">
                <img src={zoomedImage} alt="Zoom" className="w-full h-full object-contain rounded-lg" />
             </div>
        </div>
      )}

      {proofUrl && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/90 animate-in fade-in duration-200" onClick={() => setProofUrl(null)}>
             <button className="absolute top-4 right-4 text-white/70 hover:text-white p-2 cursor-pointer z-50"><X size={32} /></button>
             <iframe src={proofUrl} title="Comprobante" className="w-full max-w-4xl h-[85vh] rounded-lg bg-white" onClick={(event) => event.stopPropagation()} />
        </div>
      )}

      <h1 className="text-3xl font-bold mb-8 text-slate-800">Mi Cuenta</h1>

      <div className="bg-gradient-to-r from-slate-800 to-slate-900 rounded-2xl p-8 text-white shadow-xl mb-10 flex flex-col md:flex-row justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold mb-1">Hola, {profile?.first_name || user.email?.split('@')[0]}</h2>
          <p className="text-slate-400 text-sm">{user.email}</p>
        </div>
        <div className="mt-6 md:mt-0 flex items-center gap-4">
            <div className="text-right bg-white/10 p-4 rounded-xl backdrop-blur-sm border border-white/10">
                <p className="text-xs text-slate-300 uppercase tracking-wider mb-1">Tus Créditos ({currency})</p>
                <div className="flex flex-col items-end">
                    <span className="text-2xl font-mono font-bold text-[#9D1B1B]">{formatMoney(Number(profile?.credits || 0))}</span>
                </div>
            </div>
            <button onClick={() => setShowTransferModal(true)} className="h-full px-4 py-4 rounded-xl bg-[#9D1B1B] hover:bg-[#7E1515] text-white font-bold transition-colors flex flex-col items-center justify-center gap-1 shadow-lg cursor-pointer">
                <Send size={20} /> <span className="text-[10px] uppercase tracking-wide">Transferir</span>
            </button>
        </div>
      </div>

      {showTransferModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="bg-slate-900 p-4 flex justify-between items-center text-white">
                    <h3 className="font-bold text-lg flex items-center gap-2"><Send size={18}/> Transferir Créditos</h3>
                    <button onClick={() => setShowTransferModal(false)} className="text-slate-400 hover:text-white cursor-pointer"><X size={20}/></button>
                </div>
                <form onSubmit={handleTransfer} className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-1">Email Destinatario</label>
                        <input type="email" required placeholder="email@ejemplo.com" value={transferEmail} onChange={(e) => setTransferEmail(e.target.value)} className="w-full border border-slate-300 rounded-lg p-2 focus:ring-2 focus:ring-[#9D1B1B] outline-none"/>
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-1">Monto (USD)</label>
                        <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
                            <input type="number" required min="0.01" step="0.01" placeholder="0.00" value={transferAmount} onChange={(e) => setTransferAmount(e.target.value)} className="w-full border border-slate-300 rounded-lg pl-6 p-2 font-mono font-bold focus:ring-2 focus:ring-[#9D1B1B] outline-none"/>
                        </div>
                    </div>
                    <div className="pt-2 flex gap-3">
                        <button type="button" onClick={() => setShowTransferModal(false)} className="flex-1 py-2 rounded-lg border border-slate-300 font-bold text-slate-600 hover:bg-slate-50 cursor-pointer">Cancelar</button>
                        <button type="submit" disabled={transferLoading} className="flex-1 py-2 rounded-lg bg-[#9D1B1B] hover:bg-[#7E1515] text-white font-bold cursor-pointer disabled:opacity-50">
                            {transferLoading ? 'Enviando...' : 'Confirmar'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
      )}

      {/* BARRA DE PESTAÑAS */}
      <div className="flex border-b border-slate-200 mb-6 overflow-x-auto no-scrollbar">
        <button onClick={() => router.push('/profile?tab=stock')} className={`pb-3 px-6 font-bold text-sm transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer ${activeTab === 'stock' ? 'border-b-2 border-[#9D1B1B] text-[#9D1B1B]' : 'text-slate-500 hover:text-slate-700'}`}><Package size={18} /> Mis Compras</button>
        <button onClick={() => router.push('/profile?tab=imports')} className={`pb-3 px-6 font-bold text-sm transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer ${activeTab === 'imports' ? 'border-b-2 border-[#9D1B1B] text-[#9D1B1B]' : 'text-slate-500 hover:text-slate-700'}`}><Plane size={18} /> Pedidos Exterior</button>
        <button onClick={() => router.push('/profile?tab=wishlist')} className={`pb-3 px-6 font-bold text-sm transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer ${activeTab === 'wishlist' ? 'border-b-2 border-[#9D1B1B] text-[#9D1B1B]' : 'text-slate-500 hover:text-slate-700'}`}><Bell size={18} /> Wishlist</button>
        <button onClick={() => router.push('/profile?tab=quotes')} className={`pb-3 px-6 font-bold text-sm transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer ${activeTab === 'quotes' ? 'border-b-2 border-[#9D1B1B] text-[#9D1B1B]' : 'text-slate-500 hover:text-slate-700'}`}><Banknote size={18} /> Ventas</button>
        <button onClick={() => router.push('/profile?tab=history')} className={`pb-3 px-6 font-bold text-sm transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer ${activeTab === 'history' ? 'border-b-2 border-[#9D1B1B] text-[#9D1B1B]' : 'text-slate-500 hover:text-slate-700'}`}><Clock size={18} /> Historial</button>
        <button onClick={() => router.push('/profile?tab=settings')} className={`pb-3 px-6 font-bold text-sm transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer ${activeTab === 'settings' ? 'border-b-2 border-[#9D1B1B] text-[#9D1B1B]' : 'text-slate-500 hover:text-slate-700'}`}><UserCog size={18} /> Datos</button>
      </div>

      {activeTab === 'stock' && (
        <div className="space-y-6">
          {orders.length === 0 ? <div className="text-center py-12 bg-slate-50 rounded-xl"><p className="text-slate-500">Sin compras recientes.</p></div> : (
            orders.map((order) => (
              <div key={order.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <div className="bg-slate-50 p-4 flex flex-wrap items-center justify-between gap-4 border-b border-slate-100">
                  <div className="flex items-center gap-4">
                    <div><p className="text-xs text-slate-500 uppercase">Orden #</p><p className="font-mono font-bold text-slate-700">{String(order.id).slice(0, 8)}</p></div>
                    <div><p className="text-xs text-slate-500 uppercase">Fecha</p><p className="text-sm text-slate-700">{new Date(order.created_at).toLocaleDateString()}</p></div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                        <p className="text-xs text-slate-500 uppercase">Total</p>
                        <div className="font-bold text-slate-900">{formatDualPrice(order.total_amount)}</div>
                    </div>
                    {getStatusBadge(order.status)}
                    {(order.payment_proof_path || order.payment_proof_url) && (
                        <button
                            type="button"
                            onClick={() => handleViewProof(order.id)}
                            disabled={proofLoadingId === order.id}
                            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-50"
                        >
                            {proofLoadingId === order.id ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
                            Ver comprobante
                        </button>
                    )}
                  </div>
                </div>

                {/* BLOQUE DE PAGO SI ESTÁ PENDIENTE (Mismo código que antes) */}
                {(order.status === 'pending_payment' || order.status === 'verifying_payment') && (
                    <div className={`p-4 border-b animate-in slide-in-from-top-2 ${order.status === 'verifying_payment' ? 'bg-yellow-50 border-yellow-200' : 'bg-amber-50 border-amber-100'}`}>
                        {/* ... (Contenido de pago idéntico) ... */}
                        {order.status === 'pending_payment' ? (
                            <>
                                <h4 className="text-sm font-bold text-amber-900 mb-3 flex items-center gap-2"><CreditCard size={16}/> Datos para el Pago</h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mb-4">
                                    <div className="bg-white p-3 rounded-lg border border-amber-200">
                                        <span className="block text-xs font-bold text-amber-700 uppercase mb-1">Transferencia Pesos (ARS)</span>
                                        <div className="flex flex-col gap-1 text-xs">
                                            <div className="flex items-center justify-between">
                                                <span className="font-mono text-slate-700">Alias: coronamtg</span>
                                                <button onClick={() => copyToClipboard('coronamtg')} className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600 cursor-pointer"><Copy size={14}/></button>
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span className="font-mono text-slate-700">CVU: 0000003100018685270995</span>
                                                <button onClick={() => copyToClipboard('0000003100018685270995')} className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600 cursor-pointer"><Copy size={14}/></button>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="bg-white p-3 rounded-lg border border-amber-200">
                                        <span className="block text-xs font-bold text-amber-700 uppercase mb-1">Crypto (USDT BEP20)</span>
                                        <div className="flex items-center justify-between">
                                            <span className="font-mono text-slate-700 text-xs truncate mr-2">0x76d1f11aad0c31bf5563f646e6e4a4ba1564ebcf</span>
                                            <button onClick={() => copyToClipboard('0x76d1f11aad0c31bf5563f646e6e4a4ba1564ebcf')} className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600 cursor-pointer"><Copy size={14}/></button>
                                        </div>
                                    </div>
                                </div>
                                
                                <div className="mt-4 p-3 bg-white rounded-lg border border-amber-200">
                                    <label className="block text-xs font-bold text-amber-800 mb-2 uppercase">¿Ya pagaste? Sube el comprobante aquí:</label>
                                    <div className="flex gap-2 items-center">
                                        <input 
                                            type="file" 
                                            accept="image/*" 
                                            onChange={(e) => handleUploadProof(e, order.id)}
                                            disabled={uploadingId === order.id}
                                            className="block w-full text-xs text-slate-500
                                              file:mr-4 file:py-2 file:px-4
                                              file:rounded-full file:border-0
                                              file:text-xs file:font-semibold
                                              file:bg-amber-100 file:text-amber-700
                                              hover:file:bg-amber-200 cursor-pointer"
                                        />
                                        {uploadingId === order.id && <Loader2 className="animate-spin text-amber-600" size={18}/>}
                                    </div>
                                </div>

                                <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-3">
                                    <p className="text-xs text-amber-700 italic">
                                        Una vez realizado el pago, envía el comprobante o notifícanos.
                                    </p>
                                    <a
                                        href={buildWhatsAppUrl(whatsapp, `Hola! Envío comprobante de pago para la Orden #${String(order.id).slice(0, 8)}`)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="w-full sm:w-auto px-4 py-2 bg-[#25D366] hover:bg-[#128C7E] text-white text-xs font-bold rounded-lg flex items-center justify-center gap-2 transition-colors shadow-sm cursor-pointer"
                                    >
                                        <MessageCircle size={16} /> Notificar por WhatsApp
                                    </a>
                                </div>
                            </>
                        ) : (
                            <div className="flex items-center gap-3 text-yellow-800">
                                <Clock size={20}/>
                                <div>
                                    <p className="font-bold text-sm">Comprobante enviado</p>
                                    <p className="text-xs">Estamos verificando tu pago. Te avisaremos cuando se apruebe.</p>
                                </div>
                            </div>
                        )}
                    </div>
                )}
                
                <div className="p-4">
                  {(order.order_items || []).map((item: any, i: number) => (
                      <div key={i} className="flex items-center gap-4 mb-2 last:mb-0">
                        <div 
                            className="w-12 h-16 bg-slate-200 rounded flex-shrink-0 overflow-hidden relative border border-slate-200 group cursor-zoom-in"
                            onClick={() => item.products?.image_url && setZoomedImage(item.products.image_url)}
                        >
                            {item.products?.image_url && (<img src={item.products.image_url} alt="" className="w-full h-full object-cover" />)}
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                                <ZoomIn className="text-white opacity-0 group-hover:opacity-100 drop-shadow-md" size={16}/>
                            </div>
                        </div>
                        
                        <div className="flex-1">
                            <div className="flex items-center gap-1">
                                <span className="font-bold text-sm text-slate-800">{item.products?.name}</span>
                                {renderFinishBadge(item.products?.finish || '')}
                            </div>
                            <div className="text-xs text-slate-500 flex flex-wrap items-center gap-2 mt-1">
                                <span>{item.products?.set_name}</span>
                                {item.products?.language && <span className="bg-blue-50 text-blue-700 px-1.5 rounded uppercase font-bold border border-blue-100 text-[10px]">{item.products.language.substring(0,3)}</span>}
                                {item.products?.condition && <span className={`px-1.5 rounded font-bold border text-[10px] ${item.products.condition === 'NM' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-amber-50 text-amber-700 border-amber-100'}`}>{item.products.condition}</span>}
                            </div>
                        </div>
                        <div className="text-right"><p className="text-sm font-medium">x{item.quantity}</p></div>
                      </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Resto de pestañas sin cambios... */}
      {activeTab === 'imports' && (
        <div className="space-y-4">
          {importOrders.length === 0 ? <div className="text-center py-12 bg-slate-50 rounded-xl"><p className="text-slate-500">Sin pedidos al exterior.</p><button onClick={toggleHangModal} className="mt-4 px-6 py-2 bg-[#0F172A] text-white font-bold rounded-lg text-sm hover:bg-slate-800 cursor-pointer">Crear Pedido</button></div> : (
            importOrders.map((order) => (
              <Link key={order.id} href={`/profile/imports/${order.id}`} className="block bg-white border border-slate-200 rounded-xl p-5 hover:shadow-md transition-all hover:border-[#9D1B1B]/30 group cursor-pointer">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <span className="font-mono font-bold text-lg text-slate-800">{order.order_number}</span>
                      <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${getImportStatusColor(order.status)}`}>{order.status}</span>
                      {order.payment_status === 'verifying' && <span className="bg-yellow-100 text-yellow-800 text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1"><Clock size={10}/> Verificando Pago</span>}
                      {order.payment_status === 'paid' && <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1"><CheckCircle size={10}/> Pagado</span>}
                    </div>
                    <span className="text-xs text-slate-500 flex items-center gap-1"><Calendar size={12}/> {new Date(order.created_at).toLocaleDateString()}</span>
                  </div>
                  <ChevronRight className="text-slate-300 group-hover:text-[#9D1B1B] transition-colors"/>
                </div>
              </Link>
            ))
          )}
        </div>
      )}

      {activeTab === 'wishlist' && (
        <div className="space-y-4">
            {wishlist.length === 0 ? <div className="p-8 text-center text-slate-500">Wishlist vacía.</div> : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {wishlist.map(item => (
                        <div key={item.id} className="bg-white border border-slate-200 rounded-xl p-4 flex gap-4 items-center shadow-sm">
                            <div className="w-12 h-16 bg-slate-100 rounded overflow-hidden shrink-0 border border-slate-200 relative">
                                {item.image_url && <img src={item.image_url} className="w-full h-full object-cover"/>}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <h4 className="font-bold text-slate-900 truncate">{item.card_name}</h4>
                                    {isWishlistFoil(item) && <span className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded text-[10px] font-bold border border-purple-200">✨ Foil</span>}
                                </div>
                                <div className="text-xs text-slate-500 mt-1">
                                    {item.is_specific ? <span className="bg-purple-50 text-purple-700 px-2 py-0.5 rounded font-bold border border-purple-100">Versión Exacta</span> : <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-bold border border-blue-100">Cualquier Versión</span>}
                                </div>
                            </div>
                            <button onClick={() => removeFromWishlist(item.id)} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"><Trash2 size={18}/></button>
                        </div>
                    ))}
                </div>
            )}
        </div>
      )}

      {activeTab === 'quotes' && (
        <div className="space-y-4">
          {buylists.length === 0 ? <div className="bg-white border border-slate-200 rounded-xl p-12 text-center"><p className="text-slate-500">No tienes solicitudes de venta.</p></div> : (
            buylists.map((b) => (
              <div key={b.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <div className="bg-slate-50 p-4 flex flex-wrap items-center justify-between gap-4 border-b border-slate-100">
                  <div className="flex items-center gap-4">
                    <div><p className="text-xs text-slate-500 uppercase">{b.created_by_admin_id ? 'Cotización #' : 'Solicitud #'}</p><p className="font-mono font-bold text-slate-700">{String(b.id).slice(0, 8)}</p></div>
                    <div><p className="text-xs text-slate-500 uppercase">Fecha</p><p className="text-sm text-slate-700">{new Date(b.created_at).toLocaleDateString()}</p></div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right"><p className="text-xs text-slate-500 uppercase">Oferta</p><p className="font-bold text-slate-900">{formatMoney(b.total_offered)}</p></div>
                    {getBuylistBadge(b.status)}
                  </div>
                </div>
                {b.created_by_admin_id && (
                  <div className="flex flex-col gap-3 border-b border-purple-100 bg-purple-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-bold text-purple-900">Cotización cargada por el staff</p>
                      <p className="text-xs text-purple-800">
                        Puedes revisar el detalle, descargar el PDF y decidir si aceptas o rechazas la propuesta.
                      </p>
                      <p className="mt-1 text-xs font-bold text-purple-900">
                        Si aceptas la cotización y se valida la recepción, el dinero se acredita como créditos de tienda para usar enseguida.
                      </p>
                    </div>
                    {b.sent_at && (
                      <a
                        href={`/api/buylists/${b.id}/pdf`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center justify-center rounded-lg border border-purple-200 bg-white px-3 py-2 text-xs font-bold text-purple-700 transition hover:bg-purple-100 cursor-pointer"
                      >
                        Descargar PDF
                      </a>
                    )}
                  </div>
                )}
                {b.status === 'waiting_user_approval' && (
                  <div className="p-4 bg-blue-50 border-y border-blue-100">
                    <p className="text-sm text-blue-900 mb-3">Cotización recibida: <span className="font-bold">{formatMoney(b.total_offered)}</span></p>
                    <p className="text-xs text-blue-800 mb-3">
                      Al aceptar, este monto se acreditará como créditos de tienda y quedará listo para usar enseguida en la web.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => handleAcceptOffer(b.id)} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold cursor-pointer hover:bg-emerald-700">Aceptar Oferta</button>
                      <button onClick={() => handleRejectOffer(b.id)} className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-bold cursor-pointer hover:bg-red-700">Rechazar</button>
                    </div>
                  </div>
                )}
                <div className="border-t border-slate-100">
                  {!b.created_by_admin_id && (
                    <button onClick={() => setExpandedBuylist(expandedBuylist === b.id ? null : b.id)} className="w-full px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-50 flex items-center justify-between cursor-pointer">
                      <span>{b.buylist_items?.length || 0} Cartas enviadas</span>
                      {expandedBuylist === b.id ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}
                    </button>
                  )}
                  {(b.created_by_admin_id || expandedBuylist === b.id) && (
                    <div className="px-4 pb-4 bg-slate-50/50 border-t border-slate-100">
                       {b.created_by_admin_id && (
                         <div className="pt-3">
                           <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Resumen de la cotización</p>
                           <p className="mt-1 text-xs text-slate-600">
                             Aquí puedes revisar cada carta, su valor de mercado y el valor de compra ofrecido, sin necesidad de descargar el PDF.
                           </p>
                         </div>
                       )}
                       {b.buylist_items?.map((item: any) => (
                         <div key={item.id} className="flex items-center gap-3 py-3 border-b border-slate-200 last:border-0">
                            <button
                              type="button"
                              onClick={() => {
                                const imageUrl = getQuoteItemImage(item)
                                if (imageUrl) setZoomedImage(imageUrl)
                              }}
                              className="w-10 h-14 bg-slate-200 rounded shrink-0 relative overflow-hidden border border-slate-200 shadow-sm cursor-zoom-in"
                              title="Ampliar imagen"
                            >
                              {getQuoteItemImage(item) ? (
                                <>
                                  <img src={getQuoteItemImage(item) || ''} alt={item.card_name || 'Carta'} className="w-full h-full object-cover" />
                                  <div className="absolute inset-0 bg-black/0 hover:bg-black/20 transition-colors flex items-center justify-center">
                                    <ZoomIn size={14} className="text-white opacity-0 hover:opacity-100 transition-opacity" />
                                  </div>
                                </>
                              ) : null}
                            </button>
                            <div className="flex-1 min-w-0">
                                <span className="font-bold text-slate-800 text-sm truncate block">{item.card_name}</span>
                                <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                                    <span>{item.set_name}</span>
                                    <span className={`px-1 rounded border text-[10px] ${item.condition === 'NM' ? 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-700'}`}>{item.condition}</span>
                                    {item.is_foil && <span className="px-1 rounded border text-[10px] bg-purple-50 text-purple-700 border-purple-200">Foil</span>}
                                    {getQuoteItemProduct(item)?.language && <span className="bg-blue-50 text-blue-700 px-1.5 rounded uppercase font-bold border border-blue-100 text-[10px]">{String(getQuoteItemProduct(item)?.language).substring(0,3)}</span>}
                                    <span className="px-1 rounded border text-[10px] bg-slate-100 text-slate-700 border-slate-200">x{Math.max(1, Number(item.quantity || 1))}</span>
                                </div>
                                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600">
                                  <span>
                                    Mercado: <span className="font-bold text-slate-800">{formatMoney(getQuoteItemMarketUnitPrice(item) || 0)}</span>
                                  </span>
                                  <span>
                                    Compra: <span className="font-bold text-emerald-700">{formatMoney(Number(item.offered_price_unit || 0))}</span>
                                  </span>
                                </div>
                            </div>
                            <div className="text-right">
                              <div className="text-[11px] text-slate-500">Subtotal compra</div>
                              <div className="font-mono text-emerald-600 font-bold text-sm">
                                {formatMoney((Number(item.offered_price_unit || 0) || 0) * Math.max(1, Number(item.quantity || 1)))}
                              </div>
                            </div>
                         </div>
                       ))}
                       <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                         Si aceptas esta cotización, el total se acreditará como créditos de tienda y quedará disponible para usar inmediatamente una vez validada la recepción.
                       </div>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === 'history' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto w-full">
            <div className="min-w-[600px]">
                <div className="grid grid-cols-[1.5fr_3fr_1fr] gap-4 px-4 py-3 bg-slate-50 text-slate-600 text-sm font-bold">
                    <div>Fecha</div>
                    <div>Descripción</div>
                    <div>Monto</div>
                </div>
                {creditTxs.length === 0 ? <div className="p-6 text-center text-slate-500">Sin movimientos</div> : creditTxs.map((t) => (
                    <div key={t.id} className="grid grid-cols-[1.5fr_3fr_1fr] gap-4 px-4 py-3 border-t items-center text-sm hover:bg-slate-50 transition-colors">
                        <div className="text-slate-500">{new Date(t.created_at).toLocaleDateString()}</div>
                        <div className="text-slate-800">{String(t.transaction_desc ?? t.description)}</div>
                        <div className={Number(t.amount || t.amount_change) >= 0 ? 'text-emerald-700 font-bold' : 'text-red-700 font-bold'}>{formatMoney(Number(t.amount || t.amount_change))}</div>
                    </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'settings' && <ProfileSettings user={user} profile={profile} onProfileUpdate={(newData) => setProfile({...profile, ...newData})} />}
    </div>
  )
}

export default function ProfilePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Cargando...</div>}>
      <ProfileContent />
    </Suspense>
  )
}
