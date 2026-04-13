'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useParams } from 'next/navigation' 
import Link from 'next/link'
import Image from 'next/image'
import { ArrowLeft, CheckCircle, Package, Truck, Clock, ZoomIn, X, Banknote, Upload, CreditCard, Copy, Trash2, Plus, Info, MapPin, DollarSign, Loader2, ExternalLink } from 'lucide-react'
import { useStore } from '@/store/useStore' 
import { useUIStore } from '@/store/uiStore'
import HangOrderModal from '@/components/forms/HangOrderModal'
import { deleteImportItemAction, approveImportQuoteAction, rejectImportQuoteAction } from '@/app/actions/imports'
import { siteConfig } from '@/config/site'

// Componente visual para la barra de progreso
function OrderTimeline({ status }: { status: string }) {
    // Definimos los hitos principales para la barra
    const steps = [
        { label: 'Iniciada', icon: Clock },
        { label: 'Cotizada', icon: Banknote },
        { label: 'Procesada', icon: Package },
        { label: 'Enviada', icon: Truck },
        { label: 'Disponible', icon: CheckCircle },
    ]

    let activeIndex = 0
    if (status === 'En cotización') activeIndex = 0
    if (status === 'Cotizada' || status === 'Solo Cotización') activeIndex = 1
    if (status === 'Cotización Aprobada') activeIndex = 1 // Sigue en el hito 1 pero en transición
    if (status === 'Procesada') activeIndex = 2
    if (status === 'Enviada') activeIndex = 3
    if (status && (status.includes('Disponible') || status.includes('Completada') || status.includes('Parcialmente'))) activeIndex = 4

    return (
        <div className="relative flex justify-between w-full max-w-2xl mx-auto my-8 hidden sm:flex">
            <div className="absolute top-1/2 left-0 w-full h-1 bg-slate-100 -translate-y-1/2 -z-10 rounded-full" />
            <div className="absolute top-1/2 left-0 h-1 bg-emerald-500 -translate-y-1/2 -z-10 rounded-full transition-all duration-500" style={{ width: `${(activeIndex / (steps.length - 1)) * 100}%` }} />
            
            {steps.map((step, idx) => {
                const isActive = idx <= activeIndex
                return (
                    <div key={idx} className="flex flex-col items-center bg-white px-2">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${isActive ? 'bg-emerald-500 border-emerald-500 text-white shadow-lg shadow-emerald-200' : 'bg-white border-slate-200 text-slate-300'}`}>
                            <step.icon size={18} />
                        </div>
                        <span className={`text-[10px] font-bold mt-2 uppercase tracking-wide text-center ${isActive ? 'text-emerald-700' : 'text-slate-400'}`}>
                            {step.label}
                        </span>
                    </div>
                )
            })}
        </div>
    )
}

// Componente para la descripción detallada del estado
function StatusDescription({ status }: { status: string }) {
    if (status === 'En cotización') return null // Este estado tiene su propia pantalla completa

    const getStatusContent = () => {
        switch (status) {
            case 'Iniciada':
                return {
                    color: 'text-amber-800 bg-amber-50 border-amber-200',
                    icon: <Info className="shrink-0 text-amber-500 mt-0.5" size={20}/>,
                    title: 'Orden en preparación',
                    text: 'Los ítems que solicitaste están a la espera de cotización. El precio mostrado es solo una estimación del mercado. Puedes agregar o eliminar productos mientras nuestro equipo revisa tu solicitud.'
                }
            case 'Cotizada':
                return {
                    color: 'text-blue-900 bg-blue-50 border-blue-200',
                    icon: <Banknote className="shrink-0 text-blue-500 mt-0.5" size={20}/>,
                    title: 'Cotización finalizada',
                    text: 'Hemos calculado el precio final de tu orden (incluye impuestos y envío internacional). Por favor, verifica que las cantidades y versiones sean correctas. Si todo está en orden, puedes proceder con el pago para aprobar la cotización.'
                }
            case 'Cotización Aprobada':
                return {
                    color: 'text-emerald-800 bg-emerald-50 border-emerald-200',
                    icon: <Clock className="shrink-0 text-emerald-500 mt-0.5" size={20}/>,
                    title: 'Pago en verificación',
                    text: 'Hemos recibido tu comprobante de pago. Una vez que sea verificado por nuestro equipo y los productos sean asegurados, tu orden pasará a estado "Procesada".'
                }
            case 'Procesada':
                return {
                    color: 'text-purple-800 bg-purple-50 border-purple-200',
                    icon: <Package className="shrink-0 text-purple-500 mt-0.5" size={20}/>,
                    title: 'Orden en proceso',
                    text: 'Tu orden ha sido confirmada y está lista para ser incluida en nuestro próximo pedido de importación a los proveedores.'
                }
            case 'Enviada':
                return {
                    color: 'text-sky-800 bg-sky-50 border-sky-200',
                    icon: <Truck className="shrink-0 text-sky-500 mt-0.5" size={20}/>,
                    title: 'En tránsito internacional',
                    text: 'Tu orden ya ha sido despachada por nuestros proveedores y se encuentra en viaje hacia Argentina. Te notificaremos cuando llegue.'
                }
            case 'Parcialmente Disponible':
            case 'Disponible':
            case 'Parcialmente Completada':
            case 'Completada':
                const isPartial = status.includes('Parcialmente')
                return {
                    color: 'text-emerald-900 bg-emerald-50 border-emerald-200',
                    icon: <CheckCircle className="shrink-0 text-emerald-600 mt-0.5" size={24}/>,
                    title: isPartial ? 'Llegaron algunos de tus ítems' : '¡Tu orden ya está aquí!',
                    text: isPartial 
                        ? 'Algunos de tus ítems ya han llegado y están listos para entrega. Como trabajamos con múltiples proveedores, los productos pueden llegar en distintos envíos. Puedes retirar lo que ya está disponible o esperar a que se complete la orden.'
                        : 'Todos tus ítems han llegado a Argentina y están listos para ser entregados.',
                    showDeliveryInfo: true
                }
            case 'Solo Cotización':
                return {
                    color: 'text-slate-800 bg-slate-100 border-slate-300',
                    icon: <Info className="shrink-0 text-slate-500 mt-0.5" size={20}/>,
                    title: 'Cotización archivada',
                    text: 'Esta orden quedará almacenada solo como registro. No la tomaremos en cuenta para nuestros pedidos ya que la cotización solo es vigente el mismo día que se realiza (los precios del mercado cambian a diario). Si deseas retomar este pedido, deberás crear uno nuevo o contactarnos.'
                }
            default:
                return null
        }
    }

    const content = getStatusContent()
    if (!content) return null

    return (
        <div className={`mt-6 p-5 border rounded-xl flex gap-4 text-sm leading-relaxed ${content.color}`}>
            {content.icon}
            <div className="flex-1 space-y-3">
                <div>
                    <h3 className="font-bold text-base mb-1">{content.title}</h3>
                    <p>{content.text}</p>
                </div>

                {content.showDeliveryInfo && (
                    <div className="mt-4 pt-4 border-t border-emerald-200/50 text-emerald-800">
                        <p className="font-bold mb-3">Información de Retiro y Envíos</p>
                        <p className="text-xs mb-4">Aún no somos tienda física, por lo que <strong>los retiros presenciales deben coordinarse previamente</strong>. A continuación, nuestros horarios y puntos de encuentro:</p>
                        
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                            <div className="bg-white/60 p-3 rounded-lg border border-emerald-100">
                                <div className="flex items-center gap-2 font-bold mb-1"><MapPin size={14}/> Sarmiento 3591 (CABA)</div>
                                <div className="text-xs">Lunes a Viernes de 11:00 a 18:00 hs.</div>
                            </div>
                            <div className="bg-white/60 p-3 rounded-lg border border-emerald-100">
                                <div className="flex items-center gap-2 font-bold mb-1"><MapPin size={14}/> Magic Palace</div>
                                <div className="text-xs">Martes a Jueves desde las 18:00 hs hasta el cierre.</div>
                            </div>
                            <div className="bg-white/60 p-3 rounded-lg border border-emerald-100 sm:col-span-2">
                                <div className="flex items-center gap-2 font-bold mb-1"><MapPin size={14}/> Card Citadel</div>
                                <div className="text-xs">Viernes de 19:00 a 22:30 hs.</div>
                            </div>
                        </div>

                        <div className="bg-white/60 p-3 rounded-lg border border-emerald-100">
                            <p className="font-bold mb-1 text-sm">Opciones de envío (a cargo del comprador):</p>
                            <ul className="list-disc list-inside ml-4 text-xs space-y-1">
                                <li>Correo Argentino (Todo el país)</li>
                                <li>Moto Mensajería (Solo CABA)</li>
                            </ul>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

export default function UserOrderDetailPage() {
  const params = useParams()
  const id = params?.id as string
  
  const supabase = createClient()
  const router = useRouter()
  const rate = useStore((s) => s.usdToArsRate) || 1200
  const toggleHangModal = useUIStore((s) => s.toggleHangModal)

  const [order, setOrder] = useState<any>(null)
  const [items, setItems] = useState<any[]>([])
  const [userCredits, setUserCredits] = useState<number>(0)
  const [useCredits, setUseCredits] = useState<boolean>(false)
  const [loading, setLoading] = useState(true)
  const [zoomedImage, setZoomedImage] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  const fetchOrderData = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
          router.push('/login')
          return
      }

      // Traemos también el perfil para ver los créditos
      const { data: profile } = await supabase
          .from('profiles')
          .select('credits')
          .eq('id', user.id)
          .single()
      
      if (profile) setUserCredits(Number(profile.credits || 0))

      const { data: ord, error: ordError } = await supabase
          .from('import_orders')
          .select('*')
          .eq('id', id)
          .eq('user_id', user.id)
          .single()
      
      if (ordError || !ord) {
          console.error('Error fetching order:', ordError)
          setLoading(false)
          return
      }
      setOrder(ord)

      const { data: its } = await supabase
          .from('import_items')
          .select('*')
          .eq('order_id', id)
          .order('created_at', { ascending: true })
      
      setItems(its || [])
      setLoading(false)
  }

  useEffect(() => {
    if (!id) return
    fetchOrderData()
  }, [id, router, supabase])

  const handleDeleteItem = async (itemId: number) => {
      if (!confirm('¿Seguro que deseas eliminar esta carta de la orden?')) return
      try {
          const res = await deleteImportItemAction(itemId, order.id)
          if (!res.success) throw new Error(res.error)
          setItems(items.filter(i => i.id !== itemId))
      } catch (e: any) {
          alert('Error eliminando item: ' + e.message)
      }
  }

  const handleApproveQuote = async () => {
      // La aprobación final se da cuando sube el comprobante, 
      // pero si el usuario quiere rechazar, es otra función.
      // Aquí podríamos simplemente hacer scroll al área de pago.
      document.getElementById('payment-section')?.scrollIntoView({ behavior: 'smooth' })
  }

  const handleRejectQuote = async () => {
      if (!confirm('¿Estás seguro que deseas rechazar la cotización? La orden pasará a estado "Solo Cotización" y no se procesará.')) return
      setActionLoading(true)
      try {
          // Usamos el Server Action para bypassear RLS
          const res = await rejectImportQuoteAction(order.id)
          
          if (!res.success) {
              console.error("Error Action:", res.error)
              alert('Error al rechazar la cotización: ' + res.error)
              return
          }
          
          // Actualización optimista inmediata
          setOrder((prev: any) => ({ ...prev, status: 'Solo Cotización' }))
          alert('Cotización rechazada. Puedes volver a iniciar el proceso agregando items o contactándonos.')
          
          // Recargar por las dudas
          fetchOrderData()
      } catch (e: any) {
          alert('Error crítico: ' + e.message)
      } finally {
          setActionLoading(false)
      }
  }

  const handleUploadImportProof = async (e?: React.ChangeEvent<HTMLInputElement>) => {
      const file = e?.target?.files?.[0]
      
      // Si hay saldo restante a pagar, exigimos el comprobante
      if (remainingUsd > 0 && !file) {
          alert('Por favor sube el comprobante de pago de la diferencia.')
          return
      }

      setUploading(true)
      try {
          let publicUrl = null

          if (file) {
              const ext = file.name.split('.').pop()
              const fileName = `import_${order.id}_${Date.now()}.${ext}`
              const { error: uploadError } = await supabase.storage.from('payment_proofs').upload(fileName, file)
              if (uploadError) throw uploadError
              
              const { data } = supabase.storage.from('payment_proofs').getPublicUrl(fileName)
              publicUrl = data.publicUrl
          }

          // Usamos el Server Action para saltar el RLS de la base de datos y descontar créditos
          const res = await approveImportQuoteAction(order.id, publicUrl, creditsToUse)
          
          if (!res.success) {
              console.error("Error Action:", res.error)
              alert('Error al actualizar la orden: ' + res.error)
              return
          }
          
          const isFullyPaidWithCredits = creditsToUse > 0 && !publicUrl

          // Actualización optimista inmediata en la UI
          setOrder((prev: any) => ({
              ...prev,
              status: 'Cotización Aprobada',
              payment_status: isFullyPaidWithCredits ? 'paid' : 'verifying',
              payment_proof_url: publicUrl,
              credits_used: creditsToUse
          }))
          
          if (useCredits) {
              setUserCredits(prev => prev - creditsToUse)
          }

          alert('¡Cotización aprobada exitosamente!')
          
          // Recargamos los datos reales desde la BD por las dudas
          fetchOrderData()
      } catch (error: any) {
          alert('Error crítico: ' + error.message)
      } finally {
          setUploading(false)
      }
  }

  const copyToClipboard = (text: string) => {
      navigator.clipboard.writeText(text)
      alert('Copiado al portapapeles: ' + text)
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-slate-500">Cargando detalles...</div>
  
  if (!order) return (
    <div className="min-h-screen flex items-center justify-center text-red-500 font-bold">
        No se encontró la orden.
    </div>
  )

  const calculateEstimatedTotal = () => {
      return items.reduce((acc, item) => {
          const suggested = Number(item.suggested_price || 0) // Este valor YA incluye tax y envío
          const qty = Number(item.quantity || 1)
          return acc + (suggested * qty)
      }, 0)
  }

  const isQuoting = order.status === 'En cotización'
  const isInitiated = order.status === 'Iniciada'
  const isQuoted = order.status === 'Cotizada'
  
  // Total real cotizado (solo si ya pasó la cotización)
  const totalOrderUsd = items.reduce((acc, item) => {
      const price = Number(item.unit_price || 0)
      const tax = Number(item.tax_percent || 0)
      const ship = Number(item.shipping_cost || 0)
      const qty = Number(item.quantity || 1)
      
      const subtotal = price * (1 + (tax / 100))
      return acc + (subtotal + ship) * qty
  }, 0)

  // Cálculo de saldo restante si se usan créditos
  const activeTotalUsd = isInitiated ? calculateEstimatedTotal() : totalOrderUsd
  const creditsToUse = useCredits ? Math.min(userCredits, activeTotalUsd) : 0
  const remainingUsd = Math.max(0, activeTotalUsd - creditsToUse)

  const formatArs = (amount: number) => {
      return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(amount)
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl space-y-6 pb-20">
      
      {/* MODAL ZOOM */}
      {zoomedImage && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 animate-in fade-in duration-200" onClick={() => setZoomedImage(null)}>
             <button className="absolute top-4 right-4 text-white/70 hover:text-white p-2 cursor-pointer z-50"><X size={32} /></button>
             <div className="relative w-full max-w-lg aspect-[3/4]">
                <Image src={zoomedImage} alt="Zoom" fill className="object-contain rounded-lg" unoptimized />
             </div>
        </div>
      )}

      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link href="/profile?tab=imports" className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                <ArrowLeft size={20} className="text-slate-600"/>
            </Link>
            <div>
                <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                    Orden #{order.order_number}
                </h1>
                <p className="text-sm text-slate-500">Fecha: {new Date(order.created_at).toLocaleDateString()}</p>
            </div>
          </div>
          <a 
            href={`https://wa.me/${siteConfig.socialLinks.whatsapp}?text=${encodeURIComponent(`Hola ${siteConfig.shortName}, me gustaría información sobre la orden de importación #${order.order_number}`)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-[#25D366] hover:bg-[#20bd5a] text-white font-bold rounded-lg shadow-sm transition-colors text-sm"
          >
            Soporte WhatsApp
          </a>
      </div>

      {/* STATUS BAR */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <div className="text-center mb-6">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-bold bg-slate-100 text-slate-700">
               Estado Actual: <span className="uppercase text-[#9D1B1B]">{order.status}</span>
            </span>
        </div>
        
        {order.status !== 'Solo Cotización' && <OrderTimeline status={order.status || 'Iniciada'} />}

        <StatusDescription status={order.status || 'Iniciada'} />

        {isQuoting && (
            <div className="mt-6 p-6 bg-purple-50 border border-purple-200 rounded-xl flex flex-col items-center text-center gap-3 text-purple-800">
                <Clock className="animate-spin text-purple-500" size={32}/>
                <p className="font-bold text-lg">Estamos cotizando tu orden</p>
                <p className="text-sm">Por favor espera nuestro aviso por email para revisar la cotización final y proceder al pago.</p>
            </div>
        )}

        {isQuoted && (
            <div className="mt-6 flex flex-col sm:flex-row gap-3 w-full justify-end">
                <button onClick={handleRejectQuote} disabled={actionLoading} className="px-6 py-2 bg-white border border-red-200 text-red-600 font-bold rounded-lg hover:bg-red-50 transition-colors w-full sm:w-auto">
                    Rechazar Cotización
                </button>
                <button onClick={handleApproveQuote} disabled={actionLoading} className="px-6 py-2 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-700 shadow-md shadow-emerald-200 transition-colors w-full sm:w-auto">
                    Aprobar y Pagar
                </button>
            </div>
        )}

        {/* BLOQUE DE PAGO */}
        {(order.payment_status === 'pending' || order.payment_status === 'verifying') && !isInitiated && !isQuoting && order.status !== 'Solo Cotización' && (
            <div id="payment-section" className={`mt-6 p-6 rounded-xl border shadow-sm ${order.payment_status === 'verifying' ? 'bg-yellow-50 border-yellow-200' : 'bg-amber-50 border-amber-200'}`}>
                
                {/* OPCIÓN DE CRÉDITOS */}
                {order.payment_status === 'pending' && userCredits > 0 && (
                    <div className="mb-6 p-5 bg-white rounded-xl border-2 border-emerald-100 shadow-sm relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-50 rounded-full -mr-10 -mt-10 pointer-events-none transition-transform group-hover:scale-110"></div>
                        
                        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <div className="flex items-start gap-3">
                                <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center shrink-0 mt-1 sm:mt-0 shadow-inner">
                                    <DollarSign size={24} />
                                </div>
                                <div>
                                    <p className="font-bold text-slate-800 text-lg">Tienes US$ {userCredits.toFixed(2)} a favor</p>
                                    <p className="text-sm text-slate-500 max-w-sm mt-0.5">Puedes utilizar tus créditos disponibles para cubrir total o parcialmente el costo de esta orden.</p>
                                </div>
                            </div>
                            
                            <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-2 sm:mt-0 bg-white p-2 rounded-lg border border-slate-100 shadow-sm hover:bg-slate-50 transition-colors">
                                <input type="checkbox" className="sr-only peer" checked={useCredits} onChange={(e) => setUseCredits(e.target.checked)} />
                                <span className="mr-3 text-sm font-bold text-slate-700 select-none">Usar créditos</span>
                                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-emerald-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[10px] after:right-[24px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                            </label>
                        </div>
                        
                        {useCredits && (
                            <div className="relative z-10 mt-5 pt-4 border-t border-emerald-100/50 bg-emerald-50/50 -mx-5 -mb-5 p-5">
                                <div className="flex justify-between text-sm mb-1.5">
                                    <span className="text-slate-600">Total de la orden:</span>
                                    <span className="font-bold text-slate-800">US$ {activeTotalUsd.toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between text-sm text-emerald-600 font-bold mb-3 pb-3 border-b border-emerald-100">
                                    <span>Créditos aplicados:</span>
                                    <span>- US$ {creditsToUse.toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between text-base font-black">
                                    <span className="text-slate-800">Restante a pagar (USD):</span>
                                    <span className={remainingUsd > 0 ? "text-[#9D1B1B]" : "text-emerald-600"}>
                                        US$ {remainingUsd.toFixed(2)}
                                    </span>
                                </div>
                                {remainingUsd > 0 && (
                                    <div className="mt-4 bg-white p-4 rounded-xl border border-[#9D1B1B]/30 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 relative overflow-hidden">
                                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#9D1B1B]"></div>
                                        <div className="pl-2">
                                            <span className="block text-xs font-bold text-slate-500 uppercase mb-0.5">Debes transferir exactamente:</span>
                                            <span className="text-2xl font-black text-slate-800 tracking-tight">
                                                {formatArs(remainingUsd * rate)}
                                            </span>
                                        </div>
                                        <div className="text-right bg-slate-50 px-3 py-2 rounded-lg border border-slate-100">
                                            <span className="block text-[10px] text-slate-400 uppercase font-bold">Tipo de cambio hoy</span>
                                            <span className="text-xs font-mono font-bold text-slate-600">US$ 1 = ${rate}</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* DATOS DE PAGO (Solo si hay saldo restante a pagar y está pendiente) */}
                {order.payment_status === 'pending' && remainingUsd > 0 && (
                    <div className="mb-6">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                            <h4 className="text-sm font-bold text-amber-900 flex items-center gap-2"><CreditCard size={16}/> Datos para el Pago</h4>
                            
                            {/* Mostrar monto a transferir claro si NO usó créditos */}
                            {!useCredits && (
                                <div className="bg-white px-4 py-3 rounded-xl border-2 border-amber-300 shadow-sm flex items-center gap-4 relative overflow-hidden">
                                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-400"></div>
                                    <div className="pl-1">
                                        <span className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Debes transferir:</span>
                                        <span className="text-xl font-black text-slate-800 tracking-tight">{formatArs(remainingUsd * rate)}</span>
                                    </div>
                                    <div className="pl-3 border-l border-slate-100 text-right">
                                        <span className="block text-[10px] text-slate-400 uppercase font-bold">Total USD</span>
                                        <span className="text-xs font-mono font-bold text-slate-600">US$ {remainingUsd.toFixed(2)}</span>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mb-4">
                            <div className="bg-white p-3 rounded-lg border border-amber-200 shadow-sm">
                                <span className="block text-xs font-bold text-amber-700 uppercase mb-1">Transferencia Pesos (ARS)</span>
                                <div className="flex flex-col gap-1 text-xs">
                                    <div className="flex items-center justify-between">
                                        <span className="font-mono text-slate-700">Alias: {siteConfig.payment.bankAliasArs}</span>
                                        <button onClick={() => copyToClipboard(siteConfig.payment.bankAliasArs)} className="p-1.5 hover:bg-amber-50 rounded text-amber-400 hover:text-amber-600 cursor-pointer transition-colors" title="Copiar"><Copy size={16}/></button>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="font-mono text-slate-700">CVU: {siteConfig.payment.bankCbuArs}</span>
                                        <button onClick={() => copyToClipboard(siteConfig.payment.bankCbuArs)} className="p-1.5 hover:bg-amber-50 rounded text-amber-400 hover:text-amber-600 cursor-pointer transition-colors" title="Copiar"><Copy size={16}/></button>
                                    </div>
                                </div>
                            </div>
                            {/* Eliminado bloque de pago cripto */}
                        </div>
                    </div>
                )}

                <h3 className="font-bold text-slate-800 flex items-center gap-2 mb-2 border-t border-amber-200/50 pt-4">
                    <Banknote size={20} className="text-slate-600"/> Comprobante
                </h3>
                
                {order.payment_status === 'verifying' ? (
                    <div className="flex items-center gap-3 text-yellow-800 bg-yellow-100/50 p-3 rounded-lg">
                        <Clock size={20}/>
                        <div>
                            <p className="font-bold text-sm">Verificando Pago</p>
                            <p className="text-xs">Estamos verificando tu pago. Te avisaremos cuando se apruebe.</p>
                        </div>
                    </div>
                ) : remainingUsd === 0 ? (
                    <div className="flex flex-col items-start">
                        <p className="text-sm text-slate-600 mb-4">Esta orden se pagará en su totalidad utilizando tus créditos a favor.</p>
                        <button 
                            onClick={() => handleUploadImportProof()} 
                            disabled={uploading}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2.5 rounded-lg font-bold text-sm shadow-sm transition-all flex items-center gap-2"
                        >
                            {uploading ? <Loader2 className="animate-spin" size={16}/> : <CheckCircle size={16}/>} 
                            {uploading ? 'Procesando...' : 'Confirmar Pago con Créditos'}
                        </button>
                    </div>
                ) : (
                    <div>
                        <p className="text-sm text-slate-600 mb-4">Una vez realizado el pago del restante, sube el comprobante aquí para confirmar tu pedido.</p>
                        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
                            <label className="cursor-pointer bg-white border border-slate-300 hover:border-[#9D1B1B] text-slate-700 px-4 py-2 rounded-lg font-bold text-sm shadow-sm transition-all flex items-center gap-2 hover:bg-slate-50">
                                <Upload size={16}/> {uploading ? 'Subiendo...' : 'Subir Comprobante'}
                                <input type="file" accept="image/*" onChange={handleUploadImportProof} disabled={uploading} className="hidden" />
                            </label>
                            <div className="text-xs text-slate-400">
                                Formatos: JPG, PNG. Máx 5MB.
                            </div>
                        </div>
                    </div>
                )}
            </div>
        )}
      </div>

      {/* TABLA ITEMS */}
      {!isQuoting && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mt-6">
            <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
               <div className="font-bold text-slate-700 flex items-center gap-2">
                   <Package size={18} /> Detalle de Productos
               </div>
               {isInitiated && (
                   <button onClick={() => toggleHangModal()} className="px-3 py-1.5 bg-[#1C1B22] text-white text-sm font-bold rounded-lg hover:bg-slate-800 flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm">
                       <Plus size={16}/> Agregar items
                   </button>
               )}
            </div>
            
            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                    <thead className="bg-white text-slate-500 uppercase text-xs font-bold border-b border-slate-100">
                      <tr>
                          <th className="px-4 py-3 w-16">Img</th>
                          <th className="px-4 py-3">Producto</th>
                          <th className="px-4 py-3 text-center">Cant.</th>
                          <th className="px-4 py-3 text-right hidden sm:table-cell">
                              {isInitiated ? 'Precio Estimado' : 'Precio Final'}
                          </th>
                          <th className="px-4 py-3 text-right hidden sm:table-cell">Tax</th>
                          <th className="px-4 py-3 text-right">Total Item</th>
                          <th className="px-4 py-3 text-center">Disponibilidad</th>
                          {(isInitiated || isQuoted) && <th className="px-4 py-3 text-right"></th>}
                      </tr>
                  </thead>
                    <tbody className="divide-y divide-slate-100">
                        {items.map((item) => {
                            const qty = Number(item.quantity || 1)
                            let basePrice = 0
                            let taxPct = 0
                            let taxAmount = 0
                            let ship = 0
                            let totalItem = 0

                            if (isInitiated) {
                                // En estado Iniciada, item.suggested_price ya trae TODO sumado (Base + 10% + 0.5)
                                const suggested = Number(item.suggested_price || 0)
                                if (suggested > 0) {
                                    // Ingeniería inversa para mostrar el desglose transparente
                                    basePrice = (suggested - 0.5) / 1.10
                                    taxPct = 10
                                    taxAmount = basePrice * 0.10
                                    ship = 0.5
                                    totalItem = suggested * qty
                                } else {
                                    // Caso sin precio de referencia
                                    basePrice = 0; taxPct = 10; taxAmount = 0; ship = 0.5; totalItem = 0
                                }
                            } else {
                                // En estado Cotizada u otros, usamos los valores reales puestos por el admin
                                basePrice = Number(item.unit_price || 0)
                                taxPct = Number(item.tax_percent || 0)
                                taxAmount = basePrice * (taxPct / 100)
                                ship = Number(item.shipping_cost || 0)
                                totalItem = (basePrice + taxAmount + ship) * qty
                            }

                            return (
                                <tr key={item.id} className="hover:bg-slate-50 transition-colors group">
                                    <td className="px-4 py-3">
                                        {/* IMAGEN CON ZOOM */}
                                        <div 
                                          className="w-10 h-10 bg-slate-200 rounded overflow-hidden relative border border-slate-200 cursor-zoom-in group-hover/img:opacity-90 transition-opacity"
                                          onClick={() => item.image_url && setZoomedImage(item.image_url)}
                                        >
                                            {item.image_url ? (
                                                <>
                                                  <Image src={item.image_url} alt="" fill className="object-cover" unoptimized/>
                                                  <div className="absolute inset-0 bg-black/10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                      <ZoomIn className="text-white drop-shadow-md" size={12}/>
                                                  </div>
                                                </>
                                            ) : (
                                                <Package className="w-5 h-5 text-slate-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"/>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="font-bold text-slate-800">{item.product_name}</div>
                                        {item.product_url ? (
                                            <div className="mt-1">
                                                <a href={item.product_url.startsWith('http') ? item.product_url : `https://${item.product_url}`} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                                                    Link Referencia <ExternalLink size={10}/>
                                                </a>
                                            </div>
                                        ) : (
                                            <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                                                {item.set_name} {item.collector_number ? `#${item.collector_number}` : ''}
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-center font-bold">{qty}</td>
                                    <td className="px-4 py-3 text-right font-mono text-slate-500 hidden sm:table-cell">
                                        ${basePrice.toFixed(2)}
                                        {isQuoted && Number(item.suggested_price) > 0 && (
                                            <div className="text-[9px] text-slate-400 line-through">Est: ${Number(item.suggested_price).toFixed(2)}</div>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-right font-mono text-xs text-slate-400 hidden sm:table-cell">
                                        +${taxAmount.toFixed(2)} <span className="text-[9px]">({taxPct}%)</span>
                                    </td>
                                    <td className="px-4 py-3 text-right font-mono font-bold text-slate-900">${totalItem.toFixed(2)}</td>
                                    <td className="px-4 py-3 text-center">
                                      {item.is_delivered ? (
                                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] font-bold border border-blue-100">
                                              ENTREGADO
                                          </span>
                                      ) : item.is_available ? (
                                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-100">
                                              <CheckCircle size={10}/> DISPONIBLE
                                          </span>
                                      ) : (
                                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 text-slate-400 text-[10px] font-bold">
                                              <Clock size={10}/> PENDIENTE
                                          </span>
                                      )}
                                    </td>
                                    {(isInitiated || isQuoted) && (
                                        <td className="px-4 py-3 text-right">
                                            <button onClick={() => handleDeleteItem(item.id)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors cursor-pointer" title="Eliminar Carta">
                                                <Trash2 size={16}/>
                                            </button>
                                        </td>
                                    )}
                                </tr>
                            )
                        })}
                        
                        {/* Footer Totales */}
                        {items.length > 0 && (
                          <tr className="bg-slate-50 border-t border-slate-200">
                              <td colSpan={isInitiated ? 4 : 5} className="px-4 py-4 text-right font-bold text-slate-600 uppercase text-xs hidden sm:table-cell align-top pt-5">
                                  {isInitiated ? 'Total Estimado:' : 'Total Final Orden:'}
                              </td>
                              <td colSpan={2} className="px-4 py-4 text-right sm:text-left">
                                  <div className="flex flex-col items-end sm:items-start gap-1">
                                      <div className="flex items-center gap-2">
                                          <span className="text-xs font-bold text-slate-400">USD:</span>
                                          <span className={`font-mono font-extrabold text-xl ${isInitiated ? 'text-amber-600' : 'text-[#9D1B1B]'}`}>
                                              US$ {(isInitiated ? calculateEstimatedTotal() : totalOrderUsd).toFixed(2)}
                                          </span>
                                      </div>
                                      
                                      {/* Total en ARS */}
                                      <div className="flex items-center gap-2 bg-white px-2 py-1 rounded border border-slate-200 shadow-sm mt-1">
                                          <span className="text-xs font-bold text-slate-400">ARS:</span>
                                          <span className="font-mono font-bold text-lg text-slate-700">
                                              {formatArs((isInitiated ? calculateEstimatedTotal() : totalOrderUsd) * rate)}
                                          </span>
                                      </div>
                                      <span className="text-[10px] text-slate-400 mt-1">
                                          Cotización ref: ${rate}
                                      </span>
                                  </div>
                              </td>
                              {(isInitiated || isQuoted) && <td className="hidden sm:table-cell"></td>}
                          </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
      )}

      {/* 
        Nota: HangOrderModal está montado en el layout principal y controlado por Zustand. 
        Al llamar openHangModal() se abrirá sobre toda la aplicación.
      */}
    </div>
  )
}
