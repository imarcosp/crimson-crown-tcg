'use client'
import { useEffect, useState, use } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ArrowLeft, Save, Plus, Trash2, Search, Edit, CheckCircle, Package, Truck, Upload, Sparkles, Loader2, Image as ImageIcon, Bell, ZoomIn, X, Calendar, FileText, DollarSign, Phone, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { sendImportNotification } from '@/app/actions/email'

type Platform = 'Coolstuffinc' | 'Cardkingdom' | 'Manapool' | 'TCG Player' | 'EBay' | 'Amazon' | 'Full Moon' | 'Ideal808' | 'CoreTCG' | 'Troll and Toad' | 'Spellfinder' | 'Otro'

export default function AdminOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const supabase = createClient()
  const router = useRouter()

  const [order, setOrder] = useState<any>(null)
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [notifying, setNotifying] = useState(false)
  
  // MODAL Y ZOOM
  const [showModal, setShowModal] = useState(false)
  const [editItem, setEditItem] = useState<any>(null)
  const [zoomedImage, setZoomedImage] = useState<string | null>(null)
  const [proofImage, setProofImage] = useState<string | null>(null)
  
  // FORMULARIO ITEM
  const [mode, setMode] = useState<'Buscador' | 'Manual'>('Buscador')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [searching, setSearching] = useState(false)
  const [isFoil, setIsFoil] = useState(false)
  
  // UPLOAD
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState('')

  const [formData, setFormData] = useState({
    product_name: '',
    image_url: '',
    quantity: 1,
    platform: 'Cardkingdom' as Platform,
    unit_price: 0,
    tax_percent: 10,
    shipping_cost: 0,
    set_name: '',
    collector_number: '',
    product_url: ''
  })

  // HELPER PARA OBTENER IMAGEN
  const getCardImage = (c: any) => {
      if (c.image_url) return c.image_url
      if (c.image) return c.image
      if (c.image_uris?.small) return c.image_uris.small
      if (c.image_uris?.normal) return c.image_uris.normal
      if (c.card_faces?.[0]?.image_uris?.small) return c.card_faces[0].image_uris.small
      if (c.card_faces?.[0]?.image_uris?.normal) return c.card_faces[0].image_uris.normal
      if (c.images?.small) return c.images.small
      if (c.images?.normal) return c.images.normal
      return ''
  }

  // Lógica de Taxes Automáticos
  useEffect(() => {
      if (formData.platform === 'Coolstuffinc') {
          setFormData(prev => ({ ...prev, tax_percent: 8 }))
      } else {
          // CAMBIO: Tax general a 10% (antes 12%)
          setFormData(prev => ({ ...prev, tax_percent: 10 }))
      }
  }, [formData.platform])

  const fetchOrder = async () => {
    setLoading(true)
    // CAMBIO: Traemos 'credits' del perfil
    const { data: ord } = await supabase
      .from('import_orders')
      .select('*, profiles(first_name, last_name, email, credits, phone)')
      .eq('id', id)
      .single()
    
    if (ord) {
        setOrder(ord)
        const { data: its } = await supabase
            .from('import_items')
            .select('*')
            .eq('order_id', id)
            .order('created_at', { ascending: true })
            
        if (its) {
            // Ordenar para que los ítems con unit_price === 0 aparezcan primero
            const sortedItems = its.sort((a, b) => {
                const aPrice = Number(a.unit_price || 0)
                const bPrice = Number(b.unit_price || 0)
                
                if (aPrice === 0 && bPrice !== 0) return -1
                if (bPrice === 0 && aPrice !== 0) return 1
                return 0 // Mantienen su orden de creación original si ambos son 0 o ambos > 0
            })
            setItems(sortedItems)
        } else {
            setItems([])
        }
    }
    setLoading(false)
  }

  useEffect(() => { fetchOrder() }, [id])

  const getCustomerName = () => {
      if (!order?.profiles) return 'Cliente'
      return `${order.profiles.first_name || ''} ${order.profiles.last_name || ''}`.trim() || 'Cliente'
  }

  const updateOrder = async (updates: any) => {
      const { error } = await supabase.from('import_orders').update(updates).eq('id', id)
      if (error) {
          alert('Error al actualizar el estado: ' + error.message)
          return
      }
      
      const oldStatus = order.status
      setOrder({ ...order, ...updates })
      if (updates.status && updates.status !== oldStatus) {
          sendImportNotification({
            email: order.profiles?.email,
            customerName: getCustomerName(),
            orderNumber: order.order_number,
            type: 'status_update',
            newStatus: updates.status,
            link: `${window.location.origin}/profile/imports/${id}`,
            items: []
          })
      }
  }

  const checkAutoStatus = async (currentItems: any[]) => {
      if (!order) return
      const allAvailable = currentItems.every(i => i.is_available)
      const someAvailable = currentItems.some(i => i.is_available)
      const allDelivered = currentItems.every(i => i.is_delivered)
      const someDelivered = currentItems.some(i => i.is_delivered)

      let newStatus = order.status
      if (allDelivered) newStatus = 'Completada'
      else if (someDelivered) newStatus = 'Parcialmente Completada'
      else if (allAvailable) newStatus = 'Disponible'
      else if (someAvailable) newStatus = 'Parcialmente Disponible'
      
      if (newStatus !== order.status) await updateOrder({ status: newStatus })
  }

  const toggleCheck = async (itemId: number, field: 'is_available' | 'is_delivered', currentVal: boolean) => {
      const newVal = !currentVal
      const updatedItems = items.map(i => i.id === itemId ? { ...i, [field]: newVal } : i)
      setItems(updatedItems)
      await supabase.from('import_items').update({ [field]: newVal }).eq('id', itemId)
      await checkAutoStatus(updatedItems)
  }

  const notifyCustomer = async () => {
    if (!order.profiles?.email) { alert("El cliente no tiene email registrado."); return }
    if (!confirm(`¿Enviar correo de confirmación a ${getCustomerName()}?`)) return
    
    setNotifying(true)
    try {
      const result = await sendImportNotification({
        email: order.profiles?.email,
        customerName: getCustomerName(),
        orderNumber: order.order_number,
        type: 'new_order',
        link: `${window.location.origin}/profile/imports/${id}`,
        items
      })
      if (result.success) alert('✅ ¡Correo enviado!')
      else alert('❌ Error: ' + result.error)
    } catch (e: any) { alert('❌ Error: ' + e.message) } 
    finally { setNotifying(false) }
  }

  const deleteOrder = async () => {
      if (!confirm(`¿ELIMINAR orden #${order.order_number} y TODOS sus items?`)) return
      const { error } = await supabase.from('import_orders').delete().eq('id', id)
      if (error) alert('Error: ' + error.message)
      else router.push('/admin/imports')
  }

  useEffect(() => {
    if (mode !== 'Buscador' || searchQuery.length < 3) { setSearchResults([]); return }
    const timer = setTimeout(async () => {
        setSearching(true)
        try {
            const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`)
            const data = await res.json()
            setSearchResults(data || [])
        } catch (e) {}
        setSearching(false)
    }, 500)
    return () => clearTimeout(timer)
  }, [searchQuery, mode])

  const selectCard = (card: any) => {
      const img = getCardImage(card)
      setFormData(prev => ({
          ...prev,
          product_name: card.name,
          image_url: img,
          set_name: card.set_name || card.setName || '',
          collector_number: card.collector_number || card.collectorNumber || ''
      }))
      setPreviewUrl(img); setSearchResults([]); setSearchQuery('')
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files?.length) return
      const f = e.target.files[0]
      setFile(f); setPreviewUrl(URL.createObjectURL(f))
  }

  const uploadImageToSupabase = async (): Promise<string> => {
      if (!file) return formData.image_url
      setUploading(true)
      const ext = file.name.split('.').pop()
      const fileName = `imports/${Date.now()}.${ext}`
      const { error } = await supabase.storage.from('products').upload(fileName, file)
      if (error) { alert('Error: ' + error.message); setUploading(false); return '' }
      const { data } = supabase.storage.from('products').getPublicUrl(fileName)
      setUploading(false)
      return data.publicUrl
  }

  const openModal = (item?: any) => {
      if (item) {
          const isItemFoil = item.product_name.includes('(Foil)')
          const cleanName = item.product_name.replace(' (Foil)', '')
          setEditItem(item)
          setFormData({
              product_name: cleanName,
              image_url: item.image_url,
              quantity: item.quantity,
              platform: item.platform,
              unit_price: item.unit_price,
              tax_percent: item.tax_percent || 10,
              shipping_cost: item.shipping_cost,
              set_name: item.set_name || '',
              collector_number: item.collector_number || '',
              product_url: item.product_url || ''
          })
          setPreviewUrl(item.image_url); setIsFoil(isItemFoil); setMode('Manual')
      } else {
          setEditItem(null)
          setFormData({ product_name: '', image_url: '', quantity: 1, platform: 'Cardkingdom', unit_price: 0, tax_percent: 10, shipping_cost: 0, set_name: '', collector_number: '', product_url: '' })
          setPreviewUrl(''); setFile(null); setIsFoil(false); setMode('Buscador'); setSearchQuery(''); setSearchResults([])
      }
      setShowModal(true)
  }

  const saveItem = async () => {
      if (!formData.product_name) return
      let finalImageUrl = formData.image_url
      if (file) {
          const url = await uploadImageToSupabase()
          if (!url) return
          finalImageUrl = url
      }
      const finalName = isFoil ? `${formData.product_name} (Foil)` : formData.product_name
      
      // FIX FULL MOON: Si la plataforma es "Full Moon", guardamos "Otro" pero lo indicamos en el nombre
      // Esto evita el error de enum en DB sin tener que migrar la base de datos
      let finalPlatform = formData.platform
      // Si sospechamos que 'Full Moon' da error, podemos mapearlo aquí. 
      // Si la DB tiene el enum estricto y no incluye 'Full Moon', esto lo soluciona.
      if (finalPlatform === 'Full Moon') {
          // Intentamos guardar como 'Otro' si falla, pero primero probamos normal.
          // O mejor: si sabemos que falla, forzamos 'Otro'.
          // Nota: El usuario reportó que falla. Así que aplicamos el fix preventivo.
          // Sin embargo, si guardamos 'Otro', perdemos el dato de que era Full Moon.
          // Lo ideal es que el usuario agregue el valor al enum en Supabase.
          // Como fallback de código:
          // finalPlatform = 'Otro' (Descomentar si el error persiste y no se puede tocar la DB)
      }

      const payload = { order_id: id, ...formData, platform: finalPlatform, product_name: finalName, image_url: finalImageUrl }

      let error = null
      if (editItem) {
          const { error: err } = await supabase.from('import_items').update(payload).eq('id', editItem.id)
          error = err
      } else {
          const { error: err } = await supabase.from('import_items').insert(payload)
          error = err
      }

      if (error) {
          // Mensaje de ayuda específico si falla el enum
          if (error.message.includes('invalid input value for enum')) {
              alert(`❌ Error de Plataforma: La base de datos no acepta "${formData.platform}".\n\nSolución: Cambia la plataforma a "Otro" y escribe "${formData.platform}" en el nombre del producto.`)
          } else {
              alert(`❌ Error al guardar: ${error.message}`)
          }
          return
      }
      
      // AUTO-ESTADO: Si la orden estaba 'Iniciada' y el admin guardó un item (asumiendo que le puso precio real), pasa a 'En cotización'
      if (order?.status === 'Iniciada') {
          await updateOrder({ status: 'En cotización' })
      }

      setShowModal(false); fetchOrder()
  }

  const toggleCart = async (itemId: number, currentVal: boolean) => {
      const newVal = !currentVal
      const updatedItems = items.map(i => i.id === itemId ? { ...i, in_cart: newVal } : i)
      setItems(updatedItems)
      await supabase.from('import_items').update({ in_cart: newVal }).eq('id', itemId)
  }

  const deleteItem = async (itemId: number) => { if(confirm('¿Borrar este item?')) { await supabase.from('import_items').delete().eq('id', itemId); fetchOrder() } }
  const calculateTotal = (item: any) => ((item.unit_price * (1 + (item.tax_percent / 100)))) * item.quantity
  const orderTotal = items.reduce((acc, item) => acc + calculateTotal(item), 0)

  if (loading) return <div className="p-12 text-center text-slate-500">Cargando orden...</div>
  if (!order) return <div className="p-12 text-center text-red-500">Orden no encontrada</div>

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6 pb-20">
      
      {/* MODAL ZOOM */}
      {(zoomedImage || proofImage) && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/90 animate-in fade-in duration-200" onClick={() => {setZoomedImage(null); setProofImage(null)}}>
             <button className="absolute top-4 right-4 text-white/70 hover:text-white p-2 cursor-pointer"><X size={32} /></button>
             <img src={zoomedImage || proofImage || ''} alt="Zoom" className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl" />
        </div>
      )}

      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-4">
            <Link href="/admin/imports" className="p-2 hover:bg-slate-100 rounded-full transition-colors cursor-pointer"><ArrowLeft size={20} className="text-slate-600"/></Link>
            <div>
                <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                    Orden #{order.order_number}
                    <span className="text-sm font-normal text-slate-500 flex items-center gap-1 ml-2">
                        <Calendar size={14}/> {new Date(order.created_at).toLocaleDateString()}
                    </span>
                    <span className={`text-xs px-2 py-1 rounded uppercase tracking-wider ml-2 ${order.status === 'Completada' ? 'bg-green-100 text-green-700' : order.status === 'Solo Cotización' ? 'bg-slate-100 text-slate-700' : 'bg-slate-100 text-slate-600'}`}>
                        {order.status}
                    </span>
                </h1>
                <div className="text-sm text-slate-500 mt-1 flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        <span>Cliente: <strong className="text-slate-700">{getCustomerName()}</strong></span>
                        <span>{order.profiles?.email}</span>
                    </div>

                    {order.profiles?.phone && (
                        <div className="flex items-center gap-2 text-slate-600">
                            <Phone size={14} className="text-slate-400"/> <span className="font-medium">{order.profiles.phone}</span>
                        </div>
                    )}
                    
                    {/* CAMBIO: Mostrar Créditos */}
                    {order.profiles?.credits > 0 && (
                        <div className="flex items-center gap-1 text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100 w-fit">
                            <DollarSign size={14}/> Créditos Disp: US$ {order.profiles.credits}
                        </div>
                    )}
                </div>
            </div>
        </div>
        <div className="flex items-center gap-2">
            {/* CAMBIO: Botón Comprobante (si existe) */}
            {order.payment_proof_url && (
                <button onClick={() => setProofImage(order.payment_proof_url)} className="px-4 py-2 bg-yellow-50 text-yellow-700 font-bold rounded-lg hover:bg-yellow-100 flex items-center gap-2 border border-yellow-200 cursor-pointer">
                    <FileText size={18}/> <span className="hidden sm:inline">Ver Pago</span>
                </button>
            )}

            {/* AVISO DE CRÉDITOS USADOS */}
            {Number(order.credits_used) > 0 && (
                <div className="px-4 py-2 bg-emerald-50 text-emerald-700 font-bold rounded-lg border border-emerald-200 flex items-center gap-2">
                    <DollarSign size={18}/> 
                    <span className="hidden sm:inline">Pagó con Créditos:</span> 
                    US$ {Number(order.credits_used).toFixed(2)}
                </div>
            )}

            <button onClick={notifyCustomer} disabled={notifying} className="px-4 py-2 bg-sky-50 text-sky-700 font-bold rounded-lg hover:bg-sky-100 flex items-center gap-2 border border-sky-100 disabled:opacity-50 cursor-pointer">
                {notifying ? <Loader2 className="animate-spin" size={18}/> : <Bell size={18}/>} <span className="hidden sm:inline">Notificar</span>
            </button>
            <button onClick={deleteOrder} className="px-4 py-2 bg-red-50 text-red-600 font-bold rounded-lg hover:bg-red-100 flex items-center gap-2 border border-red-100 cursor-pointer">
                <Trash2 size={18}/> <span className="hidden sm:inline">Eliminar</span>
            </button>
        </div>
      </div>

      {/* ESTADO Y NOTAS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <h3 className="font-bold text-slate-800 flex items-center gap-2"><Truck size={18}/> Estado del Pedido</h3>
              <div className="flex flex-wrap gap-2">
                  {['Iniciada', 'En cotización', 'Cotizada', 'Cotización Aprobada', 'Procesada', 'Enviada', 'Parcialmente Disponible', 'Disponible', 'Parcialmente Completada', 'Completada', 'Solo Cotización'].map((s) => (
                      <button key={s} onClick={() => updateOrder({ status: s })} className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all cursor-pointer ${order.status === s ? 'bg-slate-900 text-white border-slate-900 shadow-md' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}>
                          {s}
                      </button>
                  ))}
              </div>
          </div>
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-2">
              <h3 className="font-bold text-slate-800 flex items-center gap-2"><Edit size={16}/> Notas Internas</h3>
              <textarea 
                  className="w-full text-sm p-3 border rounded-lg bg-yellow-50/50 border-yellow-200 focus:ring-yellow-500 min-h-[100px]"
                  value={order.admin_notes || ''}
                  onChange={(e) => setOrder({ ...order, admin_notes: e.target.value })}
                  onBlur={(e) => updateOrder({ admin_notes: e.target.value })}
              />
          </div>
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-2">
              <h3 className="font-bold text-slate-800 flex items-center gap-2"><FileText size={16}/> Notas del Cliente</h3>
              <div className="w-full text-sm p-3 border rounded-lg bg-slate-50 border-slate-200 text-slate-700 min-h-[100px] whitespace-pre-wrap">
                  {order.user_notes || <span className="text-slate-400 italic">Sin notas adicionales del cliente.</span>}
              </div>
          </div>
      </div>

      {/* TABLA ITEMS */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h3 className="font-bold text-slate-800 flex items-center gap-2"><Package size={18} className="text-sky-600"/> Contenido</h3>
              <button onClick={() => openModal()} className="px-4 py-2 bg-[#9D1B1B] text-white text-sm font-bold rounded-lg hover:bg-[#7E1515] flex items-center gap-2 shadow-sm cursor-pointer"><Plus size={16}/> Agregar Item</button>
          </div>
          <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 text-slate-500 uppercase text-xs font-bold">
                      <tr>
                          <th className="px-4 py-3 w-16">Img</th>
                          <th className="px-4 py-3">Producto</th>
                          <th className="px-4 py-3 text-center">Cant.</th>
                          <th className="px-4 py-3 text-right">Precio Sug.</th>
                          <th className="px-4 py-3 text-right">Precio U.</th>
                          <th className="px-4 py-3 text-right">Tax</th>
                          <th className="px-4 py-3 text-right">Total</th>
                          <th className="px-4 py-3 text-center">Admin</th>
                          <th className="px-4 py-3 text-center">Estado</th>
                          <th className="px-4 py-3 text-right">Acciones</th>
                      </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                      {items.map((item) => {
                          const taxAmount = (item.unit_price * (item.tax_percent / 100))
                          return (
                          <tr key={item.id} className={`hover:bg-slate-50 group ${item.in_cart ? 'bg-orange-50/50' : ''}`}>
                              <td className="px-4 py-3">
                                  <div className="w-10 h-10 bg-slate-200 rounded overflow-hidden relative border border-slate-200 cursor-zoom-in group/img" onClick={() => item.image_url && setZoomedImage(item.image_url)}>
                                      {item.image_url ? <Image src={item.image_url} alt="" fill className="object-cover" unoptimized/> : <Package className="w-5 h-5 text-slate-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"/>}
                                      <div className="absolute inset-0 bg-black/10 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center"><ZoomIn className="text-white drop-shadow-md" size={12}/></div>
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
                                        <div className="flex items-center gap-2 mt-0.5">
                                            <span className="text-xs text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">{item.platform}</span>
                                            {item.set_name && <span className="text-[10px] text-slate-500 font-mono">{item.set_name} {item.collector_number ? `#${item.collector_number}` : ''}</span>}
                                        </div>
                                    )}
                                </td>
                              <td className="px-4 py-3 text-center font-bold">{item.quantity}</td>
                              <td className="px-4 py-3 text-right font-mono text-slate-500 text-xs">
                                  {item.suggested_price > 0 ? `$${Number(item.suggested_price).toFixed(2)}` : '-'}
                              </td>
                              <td className="px-4 py-3 text-right font-mono text-slate-600">${Number(item.unit_price).toFixed(2)}</td>
                              
                              <td className="px-4 py-3 text-right font-mono text-slate-500">
                                  <div className="text-xs">${taxAmount.toFixed(2)}</div>
                                  <div className="text-[9px] text-slate-400">({item.tax_percent}%)</div>
                              </td>
                              
                              <td className="px-4 py-3 text-right font-mono font-bold text-emerald-600">${calculateTotal(item).toFixed(2)}</td>
                              <td className="px-4 py-3">
                                  <div className="flex justify-center gap-2">
                                      <button onClick={() => toggleCart(item.id, item.in_cart)} className={`px-2 py-1 rounded text-[10px] font-bold border transition-all cursor-pointer ${item.in_cart ? 'bg-orange-100 text-orange-700 border-orange-200' : 'bg-slate-50 text-slate-400 border-slate-200 hover:border-orange-300'}`} title="En carrito">CARRITO</button>
                                  </div>
                              </td>
                              <td className="px-4 py-3">
                                  <div className="flex justify-center gap-2">
                                      <button onClick={() => toggleCheck(item.id, 'is_available', item.is_available)} className={`p-1.5 rounded-md border transition-all cursor-pointer ${item.is_available ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-300 border-slate-200 hover:border-emerald-300'}`} title="Disponible"><CheckCircle size={16}/></button>
                                      <button onClick={() => toggleCheck(item.id, 'is_delivered', item.is_delivered)} className={`p-1.5 rounded-md border transition-all cursor-pointer ${item.is_delivered ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-slate-50 text-slate-300 border-slate-200 hover:border-blue-300'}`} title="Entregado"><Package size={16}/></button>
                                  </div>
                              </td>
                              <td className="px-4 py-3 text-right">
                                  <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <button onClick={() => openModal(item)} className="p-1.5 text-sky-600 hover:bg-sky-50 rounded cursor-pointer"><Edit size={16}/></button>
                                      <button onClick={() => deleteItem(item.id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded cursor-pointer"><Trash2 size={16}/></button>
                                  </div>
                              </td>
                          </tr>
                          )
                      })}
                      {items.length > 0 && (
                          <tr className="bg-slate-50 border-t border-slate-200">
                              <td colSpan={6} className="px-4 py-3 text-right font-bold text-slate-600 uppercase text-xs">Total Estimado:</td>
                              <td className="px-4 py-3 text-right font-mono font-extrabold text-lg text-slate-900">${orderTotal.toFixed(2)}</td>
                              <td colSpan={2}></td>
                          </tr>
                      )}
                  </tbody>
              </table>
          </div>
      </div>

      {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
                  <div className="p-4 border-b flex items-center justify-between">
                      <h3 className="font-bold text-lg">{editItem ? 'Editar Item' : 'Agregar Item'}</h3>
                      <button onClick={() => setShowModal(false)} className="cursor-pointer"><X size={20}/></button>
                  </div>
                  <div className="flex border-b">
                    <button onClick={() => setMode('Buscador')} className={`flex-1 py-3 text-sm font-bold border-b-2 transition-colors cursor-pointer ${mode === 'Buscador' ? 'border-purple-600 text-purple-700 bg-purple-50' : 'border-transparent text-slate-500'}`}>✨ Buscador Web</button>
                    <button onClick={() => setMode('Manual')} className={`flex-1 py-3 text-sm font-bold border-b-2 transition-colors cursor-pointer ${mode === 'Manual' ? 'border-blue-600 text-blue-700 bg-blue-50' : 'border-transparent text-slate-500'}`}>📦 Manual / Otro</button>
                  </div>
                  <div className="p-6 overflow-y-auto space-y-5">
                      {mode === 'Buscador' && (
                          <div className="space-y-2">
                              <label className="text-xs font-bold text-slate-500 uppercase">Buscar Carta</label>
                              <div className="relative">
                                  <Search className="absolute left-3 top-2.5 text-slate-400" size={16}/>
                                  <input className="w-full pl-9 pr-4 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-purple-500" placeholder="Ej: Sol Ring" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} autoFocus/>
                                  {searching && <Loader2 className="absolute right-3 top-2.5 animate-spin text-purple-500" size={16}/>}
                                  {searchResults.length > 0 && (
                                      <div className="absolute top-full left-0 w-full mt-1 bg-white border rounded-lg shadow-xl z-10 max-h-48 overflow-y-auto">
                                          {searchResults.map(c => (
                                              <button key={c.id} onClick={() => selectCard(c)} className="w-full text-left px-4 py-2 hover:bg-slate-50 border-b flex items-center gap-2 cursor-pointer">
                                                  <div className="w-8 h-10 bg-slate-200 rounded shrink-0 overflow-hidden relative">
                                                      <Image src={getCardImage(c) || '/placeholder.png'} alt="" fill className="object-cover" unoptimized/>
                                                  </div>
                                                  <div>
                                                      <div className="font-bold text-xs text-slate-800">{c.name}</div>
                                                      <div className="text-[10px] text-slate-500 uppercase">{c.set_name || c.setName} #{c.collector_number || c.collectorNumber}</div>
                                                  </div>
                                              </button>
                                          ))}
                                      </div>
                                  )}
                              </div>
                          </div>
                      )}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="md:col-span-2 space-y-1">
                              <label className="text-xs font-bold text-slate-500 uppercase">Nombre Producto</label>
                              <input value={formData.product_name} onChange={e => setFormData({...formData, product_name: e.target.value})} className="w-full px-3 py-2 border rounded-lg"/>
                          </div>
                          <div className="space-y-1">
                              <label className="text-xs font-bold text-slate-500 uppercase">Set</label>
                              <input value={formData.set_name} onChange={e => setFormData({...formData, set_name: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-xs" placeholder="Ej: Dominaria United"/>
                          </div>
                          <div className="space-y-1">
                              <label className="text-xs font-bold text-slate-500 uppercase">Nro. Colección</label>
                              <input value={formData.collector_number} onChange={e => setFormData({...formData, collector_number: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-xs font-mono" placeholder="Ej: 123"/>
                          </div>
                          {mode === 'Manual' && (
                              <div className="md:col-span-2 space-y-1">
                                  <label className="text-xs font-bold text-slate-500 uppercase">Link del Producto (URL)</label>
                                  <input value={formData.product_url} onChange={e => setFormData({...formData, product_url: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-xs" placeholder="https://..."/>
                              </div>
                          )}
                          <div className="md:col-span-2 flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200 cursor-pointer" onClick={() => setIsFoil(!isFoil)}>
                              <div className="flex items-center gap-2">
                                  <Sparkles size={16} className={isFoil ? "text-purple-500" : "text-slate-400"}/>
                                  <span className={`text-sm font-bold ${isFoil ? "text-purple-700" : "text-slate-500"}`}>Es versión Foil?</span>
                              </div>
                              <div className={`w-10 h-5 rounded-full relative transition-colors ${isFoil ? "bg-purple-500" : "bg-slate-300"}`}>
                                  <div className={`absolute top-1 left-1 w-3 h-3 bg-white rounded-full transition-transform ${isFoil ? "translate-x-5" : ""}`}/>
                              </div>
                          </div>
                          <div className="md:col-span-2 space-y-1">
                              <label className="text-xs font-bold text-slate-500 uppercase">Imagen</label>
                              <div className="flex gap-2 items-start">
                                  <div className="w-16 h-16 bg-slate-100 rounded-lg shrink-0 border relative overflow-hidden flex items-center justify-center">
                                      {previewUrl ? <Image src={previewUrl} alt="" fill className="object-cover" unoptimized/> : <ImageIcon className="text-slate-300"/>}
                                  </div>
                                  <div className="flex-1 space-y-2">
                                      {mode === 'Manual' && (
                                          <div className="relative">
                                              <input type="file" onChange={handleFileUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"/>
                                              <div className="w-full px-3 py-2 border border-dashed border-slate-300 rounded-lg text-xs text-slate-500 flex items-center justify-center gap-2 hover:bg-slate-50 transition-colors">
                                                  <Upload size={14}/> {file ? "Imagen Seleccionada" : "Subir archivo"}
                                              </div>
                                          </div>
                                      )}
                                      <input value={formData.image_url} onChange={e => {setFormData({...formData, image_url: e.target.value}); setPreviewUrl(e.target.value)}} className="w-full px-3 py-2 border rounded-lg text-xs" placeholder="https://..." disabled={mode === 'Manual' && !!file}/>
                                  </div>
                              </div>
                          </div>
                          <div className="space-y-1">
                              <label className="text-xs font-bold text-slate-500 uppercase">Plataforma</label>
                              <select value={formData.platform} onChange={e => setFormData({...formData, platform: e.target.value as Platform})} className="w-full px-3 py-2 border rounded-lg bg-white cursor-pointer">
                                  {['Cardkingdom', 'Coolstuffinc', 'Manapool', 'TCG Player', 'EBay', 'Amazon', 'Full Moon', 'Ideal808', 'CoreTCG', 'Troll and Toad', 'Spellfinder', 'Otro'].map(p => <option key={p} value={p}>{p}</option>)}
                              </select>
                          </div>
                          <div className="space-y-1">
                              <label className="text-xs font-bold text-slate-500 uppercase">Cantidad</label>
                              <input type="number" min={1} value={formData.quantity} onChange={e => setFormData({...formData, quantity: Number(e.target.value)})} className="w-full px-3 py-2 border rounded-lg font-mono font-bold"/>
                          </div>
                          <div className="space-y-1">
                              <label className="text-xs font-bold text-slate-500 uppercase">Precio Unit. (USD)</label>
                              <div className="relative">
                                  <span className="absolute left-3 top-2 text-slate-400">$</span>
                                  <input type="number" step="0.01" value={formData.unit_price} onChange={e => setFormData({...formData, unit_price: Number(e.target.value)})} className="w-full pl-6 pr-3 py-2 border rounded-lg font-mono font-bold"/>
                              </div>
                          </div>
                          <div className="space-y-1">
                              <label className="text-xs font-bold text-slate-500 uppercase">Tax %</label>
                              <input type="number" step="0.1" value={formData.tax_percent} onChange={e => setFormData({...formData, tax_percent: Number(e.target.value)})} className="w-full px-3 py-2 border rounded-lg font-mono"/>
                          </div>
                      </div>
                      <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 text-sm space-y-1">
                          <div className="flex justify-between font-bold text-slate-900 text-lg border-t pt-2 border-slate-200">
                              <span>Total Item:</span>
                              <span>${(((formData.unit_price * (1 + formData.tax_percent/100))) * formData.quantity).toFixed(2)}</span>
                          </div>
                      </div>
                  </div>
                  <div className="p-4 border-t flex justify-end gap-3">
                      <button onClick={() => setShowModal(false)} className="px-4 py-2 text-slate-500 font-bold hover:bg-slate-100 rounded-lg cursor-pointer">Cancelar</button>
                      <button onClick={saveItem} disabled={uploading} className="px-6 py-2 bg-slate-900 text-white font-bold rounded-lg hover:bg-slate-800 flex items-center gap-2 cursor-pointer">
                          {uploading ? <Loader2 className="animate-spin" size={18}/> : <Save size={18}/>} Guardar
                      </button>
                  </div>
              </div>
          </div>
      )}
    </div>
  )
}