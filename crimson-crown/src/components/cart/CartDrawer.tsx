"use client"
import { useUIStore } from '@/store/uiStore'
import { useCartStore } from '@/store/cartStore'
import { useStore } from '@/store/useStore'
import { useRouter } from 'next/navigation'
import { placeOrder } from '@/app/actions/checkout'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Save, RotateCcw, Trash2, ArrowLeft, CreditCard, Banknote, Wallet, X, Smartphone } from 'lucide-react'
import { siteConfig } from '@/config/site'

export default function CartDrawer() {
  const isOpen = useUIStore((s) => s.isCartOpen)
  const toggleCart = useUIStore((s) => s.toggleCart)
  const closeAll = useUIStore((s) => s.closeAll)
  const items = useCartStore((s) => s.items)
  const savedItems = useCartStore((s) => s.savedItems)
  const saveForLater = useCartStore((s) => s.saveForLater)
  const moveToCart = useCartStore((s) => s.moveToCart)
  const removeSaved = useCartStore((s) => s.removeSaved)
  const setSavedItems = useCartStore((s) => s.setSavedItems)

  const getSubtotal = useCartStore((s) => s.getSubtotal)
  const getTotal = useCartStore((s) => s.getTotal)
  const getDiscountAmount = useCartStore((s) => s.getDiscountAmount)
  const discount = useCartStore((s) => s.discount)
  const applyCoupon = useCartStore((s) => s.applyCoupon)
  const removeCoupon = useCartStore((s) => s.removeCoupon)
  const addItem = useCartStore((s) => s.addItem)
  const removeItem = useCartStore((s) => s.removeItem)
  const clearCart = useCartStore((s) => s.clearCart)
  const router = useRouter()
  const supabase = createClient()
  const rate = useStore((s) => s.usdToArsRate) || 1200

  const [couponInput, setCouponInput] = useState('')
  const [applying, setApplying] = useState(false)
  const [checkingOut, setCheckingOut] = useState(false)
  const [deliveryMethod, setDeliveryMethod] = useState<'pickup' | 'moto' | 'shipping' | ''>('')
  const [address, setAddress] = useState({ street: '', city: '', province: '', zip: '' })
  const [contact, setContact] = useState({ name: '', lastname: '', phone: '' })
  const [useCredits, setUseCredits] = useState(false)
  const [userCredits, setUserCredits] = useState<number>(0)
  const [zoomedImage, setZoomedImage] = useState<string | null>(null)

  // NUEVO: Estado de Vista (Carrito vs Pago)
  const [view, setView] = useState<'cart' | 'payment'>('cart')
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'transfer_ars' | 'transfer_usd' | 'credits_full' | ''>('')

  const isFullCreditPayment = useCredits && Math.max(0, getTotal() - Math.min(getTotal(), userCredits)) === 0;

  useEffect(() => { 
      if (isOpen) { 
          setCouponInput('') 
          setView('cart') // Reset al abrir
          setPaymentMethod('')
      } 
  }, [isOpen])

  useEffect(() => {
    const fetchUserData = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setUserCredits(0); return }
      
      const { data } = await supabase.from('profiles').select('credits, first_name, last_name, phone').eq('id', user.id).single()
      if (data) {
        setUserCredits(Number((data as any)?.credits || 0))
        if ((data as any).first_name || (data as any).last_name || (data as any).phone) {
          setContact({
            name: (data as any).first_name || '',
            lastname: (data as any).last_name || '',
            phone: (data as any).phone || '',
          })
        }
      }

      const { data: saved } = await supabase.from('saved_items').select('product_id, products(*)').eq('user_id', user.id)
      if (saved && saved.length > 0) {
        const mappedSaved = saved.map((row: any) => ({
            id: row.products.id,
            name: row.products.name,
            price: row.products.price_usd || 0,
            quantity: 1,
            image: row.products.image_url || '',
            maxStock: row.products.stock,
            setName: row.products.set_name,
            condition: row.products.condition
        }))
        setSavedItems(mappedSaved)
      }
    }
    if (isOpen) fetchUserData()
  }, [isOpen, supabase, setSavedItems])

  const goToPayment = () => {
      if (!items.length) return
      if (!contact.name || !contact.lastname || !contact.phone) { alert('Por favor completa tus Datos de Contacto.'); return }
      if (!deliveryMethod) { alert('Selecciona un método de envío'); return }
      if ((deliveryMethod === 'shipping' || deliveryMethod === 'moto') && (!address.street || !address.city || !address.province || !address.zip)) {
          alert('Completa la dirección de envío'); return
      }
      
      if (isFullCreditPayment) {
          setPaymentMethod('credits_full')
      } else if (paymentMethod === 'credits_full') {
          // Si antes era full credit pero ahora desmarcó la opción, reseteamos
          setPaymentMethod('')
      }
      
      setView('payment')
  }

  const handleCheckout = async () => {
    if (checkingOut) return // Protección extra contra doble click
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { toggleCart(); router.push('/login'); return }
    if (!paymentMethod) { alert('Selecciona una forma de pago.'); return }

    // GUARDAMOS EL TOTAL ANTES DE VACIAR EL CARRITO
    const cartTotalBeforeClear = getTotal()
    const itemsSnapshot = [...items]

    try {
      setCheckingOut(true)
      const cleanItems = items.map(i => ({ id: i.id, quantity: i.quantity }))
      
      // Vaciamos el carrito del estado LOCAL inmediatamente para evitar que envíen la misma lista de nuevo
      clearCart()
      
      // INYECTAMOS LA FORMA DE PAGO EN EL MÉTODO DE ENVÍO
      const paymentLabels: any = {
          'cash': 'Efectivo',
          'transfer_ars': 'Transf. Pesos',
          'transfer_usd': 'Transf. USD',
          'credits_full': '100% Créditos',
      }
      const paymentInfo = paymentLabels[paymentMethod]
      
      const shippingDetails = { 
          method: `${deliveryMethod} [Pago: ${paymentInfo}]`, 
          address: (deliveryMethod === 'shipping' || deliveryMethod === 'moto') ? address : undefined 
      }
      
      const res = await placeOrder(cleanItems, discount?.code, shippingDetails, useCredits, contact)
      if (!res?.success) throw new Error(res?.error || 'Error procesando la orden')
      
      try { await supabase.from('cart_items').delete().eq('user_id', user.id) } catch {}
      removeCoupon()
      toggleCart()

      // Eliminado flujo de Mercado Pago

      router.push(`/checkout/success/${res.orderId}`)
    } catch (e: any) {
      // Restauramos el carrito local si falló la orden (si usamos itemsSnapshot aseguramos restaurar lo que había)
      if (items.length === 0 && typeof itemsSnapshot !== 'undefined') {
          itemsSnapshot.forEach(item => addItem(item))
      }
      alert(e?.message || 'No se pudo procesar la compra')
    } finally {
      setCheckingOut(false)
    }
  }

  const handleEmptyCart = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    clearCart()
    try { if (user) await supabase.from('cart_items').delete().eq('user_id', user.id) } catch {}
  }

  const handleApplyCoupon = async () => {
    const code = couponInput.trim().toUpperCase()
    if (!code) return
    setApplying(true)
    try {
      const { data, error } = await supabase.from('coupons').select('*').eq('code', code).single()
      if (error || !data?.active) throw new Error('Cupón inválido')
      const type = data.discount_type === 'percentage' ? 'percentage' : 'fixed'
      applyCoupon({ code: data.code, type, value: Number(data.value) })
      setCouponInput('')
      alert('Cupón aplicado')
    } catch (e: any) { alert(e.message || 'Error al aplicar cupón') } finally { setApplying(false) }
  }

  return (
    <>
    <div className={`fixed inset-0 z-50 transition-visibility duration-300 ${isOpen ? 'visible' : 'invisible'}`}>
      <div onClick={closeAll} className={`absolute inset-0 bg-black/40 transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0'}`} />

      <div className={`absolute right-0 top-0 h-full w-full md:w-[28rem] bg-white shadow-2xl transform transition-transform duration-300 ease-in-out flex flex-col ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        
        {/* HEADER */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200 flex-none bg-white z-10">
          {view === 'payment' ? (
              <button onClick={() => setView('cart')} className="flex items-center gap-1 text-sm font-bold text-slate-500 hover:text-slate-800 cursor-pointer"><ArrowLeft size={16}/> Volver</button>
          ) : (
              <h3 className="text-lg font-bold text-slate-900">Tu Compra</h3>
          )}
          <div className="flex items-center gap-2">
            {view === 'cart' && items.length > 0 && (
              <button onClick={handleEmptyCart} className="px-3 py-1.5 rounded-lg text-sm font-bold text-slate-600 hover:text-red-600 hover:bg-red-50 border border-slate-200 hover:border-red-200 transition-colors flex items-center gap-1 cursor-pointer" title="Vaciar carrito"><Trash2 size={14}/> Vaciar</button>
            )}
            <button onClick={toggleCart} className="p-2 rounded-full hover:bg-slate-100 transition-colors text-slate-500 cursor-pointer" aria-label="Cerrar carrito">✕</button>
          </div>
        </div>

        {/* CONTENIDO PRINCIPAL */}
        <div className="flex-1 overflow-y-auto p-4 bg-white">
            {/* VISTA 1: CARRITO Y DATOS */}
            {view === 'cart' && (
                <div className="space-y-6">
                    <div className="space-y-4">
                        {items.length ? items.map((it) => (
                        <div key={it.id} className="flex items-center gap-3 bg-white">
                            <div 
                                className="relative h-16 w-12 bg-slate-100 overflow-hidden rounded shrink-0 border border-slate-200 cursor-zoom-in group"
                                onClick={() => it.image && setZoomedImage(it.image)}
                            >
                                {it.image && <img src={it.image} alt={it.name} className="absolute inset-0 w-full h-full object-cover group-hover:scale-110 transition-transform duration-300" />}
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors"></div>
                            </div>
                            <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-slate-900 truncate">{it.name}</div>
                            <div className="mt-1 flex items-center gap-2">
                                <button onClick={() => removeItem(it.id)} className="w-6 h-6 flex items-center justify-center rounded bg-slate-100 hover:bg-slate-200 text-xs cursor-pointer">-</button>
                                <span className="text-sm font-bold w-4 text-center">{it.quantity}</span>
                                <button onClick={() => addItem({ ...it, quantity: 1 } as any)} disabled={it.maxStock !== undefined && it.quantity >= (it.maxStock || 0)} className="w-6 h-6 flex items-center justify-center rounded bg-slate-100 hover:bg-slate-200 text-xs disabled:opacity-50 cursor-pointer">+</button>
                            </div>
                            </div>
                            <div className="flex flex-col items-end gap-1">
                                <div className="text-sm font-bold text-[#9D1B1B]">US$ {Number(it.price || 0).toFixed(2)}</div>
                                <button onClick={() => saveForLater(it.id)} className="text-[10px] text-blue-500 hover:text-blue-700 flex items-center gap-1 font-bold cursor-pointer"><Save size={12}/> Guardar</button>
                            </div>
                        </div>
                        )) : (
                        <div className="flex flex-col items-center justify-center h-40 text-slate-400"><p>Tu carrito está vacío</p></div>
                        )}
                    </div>

                    {savedItems && savedItems.length > 0 && (
                        <div className="pt-4 border-t border-slate-100 mt-4">
                            <h4 className="text-xs font-bold text-slate-500 uppercase mb-3 flex items-center gap-2"><Save size={12}/> Guardado para después</h4>
                            <div className="space-y-3 opacity-90">
                                {savedItems.map((it) => (
                                    <div key={it.id} className="flex gap-3 items-center bg-slate-50 p-2 rounded border border-slate-100">
                                        <div 
                                            className="w-8 h-10 bg-white rounded overflow-hidden relative shrink-0 border cursor-zoom-in group"
                                            onClick={() => it.image && setZoomedImage(it.image)}
                                        >
                                            {it.image && <img src={it.image} alt="" className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all" />}
                                        </div>
                                        <div className="flex-1 min-w-0"><div className="text-xs font-bold text-slate-700 truncate">{it.name}</div><div className="text-[10px] text-slate-500">US$ {Number(it.price || 0).toFixed(2)}</div></div>
                                        <div className="flex gap-1">
                                            <button onClick={() => moveToCart(it.id)} className="p-1.5 bg-white border rounded text-emerald-600 hover:border-emerald-500 shadow-sm cursor-pointer"><RotateCcw size={14}/></button>
                                            <button onClick={() => removeSaved(it.id)} className="p-1.5 text-slate-400 hover:text-red-500 cursor-pointer"><Trash2 size={14}/></button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {items.length > 0 && (
                        <>
                        <hr className="border-slate-100" />
                        <div className="space-y-3">
                            <div className="text-sm font-bold text-slate-900">Datos de Contacto</div>
                            <div className="grid grid-cols-2 gap-3">
                                <input placeholder="Nombre" value={contact.name} onChange={e => setContact({...contact, name: e.target.value})} className="border border-slate-300 rounded px-3 py-2 text-sm w-full focus:ring-1 focus:ring-slate-900 outline-none" />
                                <input placeholder="Apellido" value={contact.lastname} onChange={e => setContact({...contact, lastname: e.target.value})} className="border border-slate-300 rounded px-3 py-2 text-sm w-full focus:ring-1 focus:ring-slate-900 outline-none" />
                            </div>
                            <input placeholder="Teléfono / WhatsApp" type="tel" value={contact.phone} onChange={e => setContact({...contact, phone: e.target.value})} className="border border-slate-300 rounded px-3 py-2 text-sm w-full focus:ring-1 focus:ring-slate-900 outline-none" />
                        </div>

                        <hr className="border-slate-100" />
                        <div className="space-y-3">
                            <div className="text-sm font-bold text-slate-900">Método de Entrega</div>
                            <div className="space-y-2">
                                {[{ id: 'pickup', label: 'Retiro', desc: 'Retirar' }, { id: 'moto', label: 'Moto Mensajería', desc: 'CABA/GBA - A cargo del comprador' }, { id: 'shipping', label: 'Correo Argentino', desc: 'Envío a todo el país' }].map(( method ) => (
                                    <label key={method.id} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${deliveryMethod === method.id ? 'border-emerald-500 bg-emerald-50/50' : 'border-slate-200 hover:bg-slate-50'}`}>
                                        <input type="radio" name="delivery" checked={deliveryMethod === method.id} onChange={() => setDeliveryMethod(method.id as any)} className="mt-1 accent-emerald-600 cursor-pointer" />
                                        <div><div className="text-sm font-bold text-slate-800">{method.label}</div><div className="text-xs text-slate-500">{method.desc}</div></div>
                                    </label>
                                ))}
                            </div>
                            {(deliveryMethod === 'shipping' || deliveryMethod === 'moto') && (
                                <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200 animate-in fade-in slide-in-from-top-2">
                                    <input type="text" placeholder="Calle y altura" value={address.street} onChange={(e) => setAddress({ ...address, street: e.target.value })} className="col-span-2 border rounded px-3 py-2 text-sm" />
                                    <input type="text" placeholder="Ciudad" value={address.city} onChange={(e) => setAddress({ ...address, city: e.target.value })} className="border rounded px-3 py-2 text-sm" />
                                    <input type="text" placeholder="Provincia" value={address.province} onChange={(e) => setAddress({ ...address, province: e.target.value })} className="border rounded px-3 py-2 text-sm" />
                                    <input type="text" placeholder="Código Postal" value={address.zip} onChange={(e) => setAddress({ ...address, zip: e.target.value })} className="col-span-2 border rounded px-3 py-2 text-sm" />
                                </div>
                            )}
                        </div>
                        </>
                    )}
                </div>
            )}

            {/* VISTA 2: SELECCIÓN DE PAGO */}
            {view === 'payment' && (
                <div className="space-y-6 animate-in slide-in-from-right duration-300">
                    {isFullCreditPayment ? (
                        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 p-6 rounded-xl text-center space-y-3">
                            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-2 text-emerald-600">
                                <Wallet size={32} />
                            </div>
                            <h3 className="font-bold text-xl">Pago Cubierto al 100%</h3>
                            <p className="text-sm">Tus créditos a favor son suficientes para cubrir la totalidad de esta orden. No es necesario realizar transferencias ni subir comprobantes.</p>
                            <p className="text-xs text-emerald-700 font-bold mt-4 pt-4 border-t border-emerald-200/50">
                                Se descontarán US$ {getTotal().toFixed(2)} de tus créditos.
                            </p>
                        </div>
                    ) : (
                        <>
                            <div className="bg-amber-50 border border-amber-200 text-amber-900 p-4 rounded-xl text-sm mb-4">
                                <p className="font-bold flex items-center gap-2 mb-1"><RotateCcw size={16}/> Recordatorio</p>
                                <p>Si el pago no se acredita en <strong>3 días hábiles</strong>, la orden será cancelada automáticamente.</p>
                            </div>

                            <div className="space-y-4">
                                <label className={`flex items-center gap-4 p-4 border rounded-xl cursor-pointer transition-all ${paymentMethod === 'cash' ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500' : 'hover:bg-slate-50 border-slate-200'}`}>
                                    <input type="radio" name="payment" checked={paymentMethod === 'cash'} onChange={() => setPaymentMethod('cash')} className="w-5 h-5 accent-emerald-600 cursor-pointer"/>
                                    <div className="flex-1">
                                        <div className="font-bold text-slate-800 flex items-center gap-2"><Banknote size={20}/> Efectivo</div>
                                        <div className="text-xs text-slate-500">Abonar al retirar.</div>
                                    </div>
                                </label>

                                {/* Eliminadas plataformas digitales (Mercado Pago) */}

                                <div className="border border-slate-200 rounded-xl overflow-hidden">
                                    <div className="bg-slate-50 p-3 text-xs font-bold text-slate-500 uppercase flex items-center gap-2 border-b border-slate-200"><CreditCard size={14}/> Transferencia</div>
                                    <div className="divide-y divide-slate-100">
                                        {[
                                            { id: 'transfer_ars', label: 'Pesos (ARS)', alias: siteConfig.payment.bankAliasArs }
                                        ].map((pm) => (
                                            <label key={pm.id} className={`flex items-center gap-4 p-4 cursor-pointer hover:bg-slate-50 transition-colors ${paymentMethod === pm.id ? 'bg-sky-50' : ''}`}>
                                                <input type="radio" name="payment" checked={paymentMethod === pm.id} onChange={() => setPaymentMethod(pm.id as any)} className="w-4 h-4 accent-sky-600 cursor-pointer"/>
                                                <div className="flex-1">
                                                    <div className="font-bold text-slate-800 text-sm">{pm.label}</div>
                                                    <div className="text-xs text-slate-400 font-mono mt-0.5">Alias: {pm.alias}</div>
                                                </div>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>

        {/* FOOTER FIJO */}
        <div className="flex-none p-4 bg-white border-t border-slate-200 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] z-20">
          
          {view === 'cart' && (
              <>
                {!discount ? (
                    <div className="flex gap-2 mb-4">
                    <input value={couponInput} onChange={(e) => setCouponInput(e.target.value.toUpperCase())} placeholder="CÓDIGO DE CUPÓN" className="border border-slate-300 rounded px-3 py-2 text-sm flex-1 uppercase focus:ring-1 focus:ring-slate-900 outline-none" />
                    <button onClick={handleApplyCoupon} disabled={applying} className="bg-slate-800 hover:bg-slate-900 text-white px-4 py-2 text-xs font-bold rounded transition-colors disabled:opacity-50 cursor-pointer">APLICAR</button>
                    </div>
                ) : (
                    <div className="flex justify-between items-center text-xs bg-emerald-50 border border-emerald-100 px-3 py-2 rounded mb-4 text-emerald-700 font-bold">
                    <span className="flex items-center gap-2">🏷️ Cupón: {discount.code}</span>
                    <button onClick={removeCoupon} className="hover:text-emerald-900 cursor-pointer">Eliminar</button>
                    </div>
                )}

                <div className="space-y-2 text-sm mb-4">
                    <div className="flex justify-between text-slate-600"><span>Subtotal</span><span>US$ {getSubtotal().toFixed(2)}</span></div>
                    {discount && <div className="flex justify-between text-emerald-600 font-medium"><span>Descuento</span><span>- US$ {getDiscountAmount().toFixed(2)}</span></div>}
                    {userCredits > 0 && (
                        <label className="flex items-center justify-between py-2 cursor-pointer group">
                            <span className="flex items-center gap-2 text-slate-600 group-hover:text-slate-900"><input type="checkbox" checked={useCredits} onChange={(e) => setUseCredits(e.target.checked)} className="accent-slate-900 cursor-pointer" /> Usar créditos</span>
                            <span className="font-mono text-xs bg-slate-100 px-2 py-1 rounded">Disp: US$ {userCredits.toFixed(2)}</span>
                        </label>
                    )}
                    {useCredits && userCredits > 0 && (<div className="flex justify-between text-blue-600 text-xs font-bold"><span>Créditos aplicados</span><span>- US$ {Math.min(getTotal(), userCredits).toFixed(2)}</span></div>)}
                    
                    <div className="flex justify-between items-end border-t border-slate-100 pt-3 mt-2">
                        <span className="font-bold text-slate-900 text-lg">Total</span>
                        <div className="text-right">
                            <span className="font-extrabold text-2xl text-[#9D1B1B]">
                                US$ {(Math.max(0, getTotal() - (useCredits ? Math.min(getTotal(), userCredits) : 0))).toFixed(2)}
                            </span>
                        </div>
                    </div>
                </div>

                <button onClick={goToPayment} disabled={!items.length} className="w-full bg-[#1C1B22] text-white py-4 rounded-xl font-bold text-base hover:bg-black disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed transition-all shadow-lg shadow-slate-900/10 active:scale-[0.98] cursor-pointer">
                    CONTINUAR
                </button>
              </>
          )}

          {view === 'payment' && (
              <div className="space-y-4">
                  {/* RESUMEN DINÁMICO DEL MÉTODO SELECCIONADO */}
                  {paymentMethod && !isFullCreditPayment && (
                      <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 animate-in fade-in slide-in-from-bottom-2">
                          <h4 className="text-xs font-bold text-slate-500 uppercase mb-3 border-b border-slate-200 pb-2">Resumen de Pago</h4>
                          
                          {(() => {
                              const baseUsd = Math.max(0, getTotal() - (useCredits ? Math.min(getTotal(), userCredits) : 0))
                              const finalUsd = baseUsd
                              const finalArs = finalUsd * rate
                              
                              return (
                                  <div className="space-y-2">
                                      <div className="flex justify-between text-sm">
                                          <span className="text-slate-600">Total Orden (USD)</span>
                                          <span className="font-bold text-slate-800">US$ {baseUsd.toFixed(2)}</span>
                                      </div>
                                      
                                      {/* Recargo Mercado Pago eliminado */}
                                      
                                      <div className="flex justify-between items-end pt-3 border-t border-slate-200 mt-2">
                                          <span className="font-bold text-slate-900 text-base">Total a Pagar</span>
                                          <div className="text-right">
                                              <span className="font-black text-xl text-slate-900">US$ {finalUsd.toFixed(2)}</span>
                                              <span className="block text-xs font-bold text-slate-500 bg-white px-2 py-1 rounded border border-slate-200 shadow-sm mt-1">
                                                  ~ ARS ${finalArs.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                                              </span>
                                          </div>
                                      </div>
                                  </div>
                              )
                          })()}
                      </div>
                  )}

                  <button onClick={handleCheckout} disabled={checkingOut || !paymentMethod} className="w-full bg-[#9D1B1B] text-white py-4 rounded-xl font-bold text-base hover:bg-[#7E1515] disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed transition-all shadow-lg shadow-red-900/10 active:scale-[0.98] cursor-pointer">
                      {checkingOut ? 'PROCESANDO...' : 'CONFIRMAR COMPRA'}
                  </button>
              </div>
          )}
        </div>
      </div>
    </div>

    {/* ZOOM MODAL */}
    {zoomedImage && (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 animate-in fade-in duration-200" onClick={() => setZoomedImage(null)}>
           <button className="absolute top-4 right-4 text-white/70 hover:text-white p-2 cursor-pointer z-50">
               <X size={32} />
           </button>
           <div className="relative w-full max-w-lg aspect-[3/4]">
              <img src={zoomedImage} alt="Zoom" className="w-full h-full object-contain rounded-lg" />
           </div>
      </div>
    )}
    </>
  )
}
