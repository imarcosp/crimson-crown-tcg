"use client"
import { useState, useEffect } from 'react'
import { useStore } from '@/store/useStore'
import { useCartStore } from '@/store/cartStore'
import { useUIStore } from '@/store/uiStore'
import { useQuoteStore } from '@/store/quoteStore'
import { ShoppingCart, ArrowLeft, CheckCircle, PackageOpen, Bell, ZoomIn, X } from 'lucide-react'
import QuantitySelector from './QuantitySelector'
import { useConfig } from '@/context/ConfigContext'
import Link from 'next/link'
import PriceHistory from './PriceHistory'
import WishlistModal from './WishlistModal'
import { createClient } from '@/lib/supabase/client'

type Props = {
  product: any
  priceHistory?: any[]
}

export default function ProductDetailView({ product: p, priceHistory }: Props) {
  const currency = useStore((s) => s.currency)
  const { exchangeRate } = useConfig()
  const cartItems = useCartStore((s) => s.items)
  const addItem = useCartStore((s) => s.addItem)
  const openCart = useUIStore((s) => s.openCart)
  const addQuote = useQuoteStore((s) => s.addItem)
  const toggleHangModal = useUIStore((s) => s.toggleHangModal)
  const supabase = createClient()

  // Estados Wishlist
  const [showWishlistModal, setShowWishlistModal] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [zoomed, setZoomed] = useState(false)

  // --- LÓGICA DE GALERÍA ---
  const mainImage = p.image || '/placeholder.png'
  const gallery = Array.isArray(p.metadata?.gallery) ? p.metadata.gallery : []
  // Combinamos portada + galería, filtrando vacíos
  const allImages = [mainImage, ...gallery].filter(Boolean)
  
  const [activeImg, setActiveImg] = useState(mainImage)

  // Resetear imagen si cambiamos de producto
  useEffect(() => {
    setActiveImg(p.image || '/placeholder.png')
  }, [p.id, p.image])

  const price = currency === 'USD' ? p.priceUsd : Math.round(p.priceUsd * exchangeRate)
  const symbol = currency === 'USD' ? 'US$' : '$'

  const inCart = cartItems.find((i) => i.id === p.id)

  const handleWishlistClick = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
        alert('Debes iniciar sesión para usar la Wishlist.')
        return
    }
    setUserId(user.id)
    setShowWishlistModal(true)
  }

  return (
    <div className="container mx-auto px-4 py-8">
      
      {/* MODAL ZOOM PANTALLA COMPLETA */}
      {zoomed && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/95 animate-in fade-in duration-200" onClick={() => setZoomed(false)}>
             <button className="absolute top-4 right-4 text-white/70 hover:text-white p-2 cursor-pointer z-50"><X size={32} /></button>
             <img src={activeImg} alt="Zoom" className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl" />
        </div>
      )}

      <Link href="/catalog" className="inline-flex items-center text-sm text-slate-500 hover:text-[#9D1B1B] mb-6 transition-colors">
        <ArrowLeft size={16} className="mr-1" /> Volver al Catálogo
      </Link>
      
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden relative">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5">
          
          {/* COLUMNA IZQUIERDA: IMAGEN + GALERÍA */}
          <div className="lg:col-span-2 bg-slate-100 p-8 flex flex-col items-center justify-start gap-6">
            
            {/* Imagen Principal */}
            <div 
                className="relative w-full max-w-sm aspect-[3/4] shadow-xl rounded-xl overflow-hidden group bg-white cursor-zoom-in"
                onClick={() => setZoomed(true)}
            >
              <img src={activeImg} alt={p.name} className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                  <ZoomIn className="text-white opacity-0 group-hover:opacity-100 drop-shadow-md" size={32}/>
              </div>
              
              {p.isFoil && p.finish && (
                <div className="absolute top-4 right-4 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow-lg z-20">✨ {String(p.finish).toUpperCase()}</div>
              )}
            </div>

            {/* Tira de Miniaturas (Solo si hay más de 1) */}
            {allImages.length > 1 && (
                <div className="flex gap-3 overflow-x-auto max-w-full py-2 px-1 no-scrollbar w-full justify-center">
                    {allImages.map((img, idx) => (
                        <button 
                            key={idx} 
                            onClick={() => setActiveImg(img)}
                            className={`relative w-16 h-20 rounded-lg overflow-hidden border-2 flex-shrink-0 transition-all cursor-pointer ${activeImg === img ? 'border-[#9D1B1B] shadow-md scale-105 ring-2 ring-[#9D1B1B]/20' : 'border-white hover:border-slate-300 opacity-80 hover:opacity-100'}`}
                        >
                            <img src={img} className="w-full h-full object-cover" alt="" />
                        </button>
                    ))}
                </div>
            )}
          </div>

          {/* COLUMNA DERECHA: DETALLES (Sin Cambios Lógicos) */}
          <div className="lg:col-span-3 p-8 lg:p-12 flex flex-col">
            <div className="mb-auto">
              <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="bg-slate-900 text-white text-xs font-bold px-2 py-1 rounded">{p.tcg}</span>
                    <span className="bg-slate-100 text-slate-600 text-xs font-bold px-2 py-1 rounded uppercase">{p.condition}</span>
                    {p.stock > 0 ? (
                    <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-1 rounded flex items-center gap-1"><CheckCircle size={12} /> EN STOCK</span>
                    ) : (
                    <span className="bg-indigo-100 text-indigo-700 text-xs font-bold px-2 py-1 rounded flex items-center gap-1"><PackageOpen size={12} /> POR ENCARGO</span>
                    )}
                  </div>
                  
                  <button 
                    onClick={handleWishlistClick}
                    className="px-3 py-1.5 rounded-full bg-slate-100 text-slate-600 hover:text-[#9D1B1B] hover:bg-red-50 transition-colors border border-slate-200 flex items-center gap-2 text-xs font-bold shadow-sm"
                  >
                    <Bell size={16} className="stroke-[2.5]" />
                    <span>Agregar a Wishlist</span>
                  </button>
              </div>

              <h1 className="text-3xl md:text-4xl font-bold text-slate-900 mb-2">{p.name}</h1>
              <p className="text-lg text-slate-500 mb-6">{p.setName} {p.collectorNumber && `• #${p.collectorNumber}`}</p>
              
              {p.isImport && (
                <div className="bg-blue-50 border border-blue-100 text-blue-800 text-sm p-4 rounded-lg mb-6">ℹ️ <strong>Producto de Importación:</strong> No contamos con stock físico local inmediato. Al comprarlo, gestionaremos su importación para ti.</div>
              )}
              
              {p.stock > 0 && (
                  <div className="flex items-baseline gap-2 mb-4">
                    <span className="text-5xl font-bold text-[#9D1B1B] tracking-tight">{symbol} {price.toFixed(2)}</span>
                    {currency !== 'USD' && <span className="text-slate-400 text-sm">aprox. (Cotización del día)</span>}
                  </div>
              )}

              {priceHistory && priceHistory.length > 1 && (
                 <div className="mb-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
                    <PriceHistory data={priceHistory} />
                 </div>
              )}
            </div>

            <div className="border-t border-slate-100 pt-8">
              {p.stock > 0 ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-sm text-slate-600 mb-2">
                    <span>Stock disponible: <strong>{p.stock}</strong></span>
                  </div>
                  {inCart ? (
                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                      <p className="text-sm text-slate-600 mb-3 font-medium text-center">Ya tienes este producto en tu carrito</p>
                      <div className="flex justify-center">
                        <QuantitySelector productId={p.id} maxStock={p.stock} />
                      </div>
                      <button onClick={openCart} className="w-full mt-3 text-sm text-[#9D1B1B] font-bold hover:underline">Ver Carrito</button>
                    </div>
                  ) : (
                    <button onClick={() => { addItem({ ...p, imageUrl: p.image, stock: p.stock }); openCart() }} className="w-full bg-[#9D1B1B] hover:bg-[#7E1515] text-white py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-3 shadow-xl shadow-red-900/10 transition-transform active:scale-95 cursor-pointer">
                      <ShoppingCart /> Agregar al Carrito
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex flex-col md:flex-row items-center gap-4">
                  <button onClick={() => { addQuote({ id: p.id, name: p.name, price: p.priceUsd, image: p.image, setName: p.setName }); toggleHangModal() }} className="w-full md:w-auto px-8 bg-white border-2 border-[#9D1B1B] text-[#9D1B1B] hover:bg-red-50 py-4 rounded-xl font-bold text-lg transition-colors cursor-pointer whitespace-nowrap">
                    Solicitar Cotización
                  </button>
                  <p className="text-slate-500 text-sm font-medium flex items-center gap-2">
                    <span>📦</span> Sin stock, disponible para importación (15 dias).
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {showWishlistModal && userId && (
        <WishlistModal 
            product={p} 
            userId={userId} 
            onClose={() => setShowWishlistModal(false)} 
        />
      )}
    </div>
  )
}
