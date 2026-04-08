"use client"
import { useState } from 'react'
import { useStore } from '@/store/useStore'
import { useCartStore } from '@/store/cartStore'
import { useUIStore } from '@/store/uiStore'
import { useQuoteStore } from '@/store/quoteStore'
import { ShoppingCart, Sparkles, Check, Bell } from 'lucide-react'
import QuantitySelector from './QuantitySelector'
import { useConfig } from '@/context/ConfigContext'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import WishlistModal from './WishlistModal'
import { getCardImageUrl } from '@/lib/utils/images'

type Props = {
  id: string
  name: string
  tcg: string
  priceUsd: number
  priceUsdFoil?: number
  stock: number
  condition: string
  isFoil: boolean
  finish?: string 
  rarity: string
  image?: string
  image_url?: string
  setName?: string
  collectorNumber?: string
  availability?: 'stock' | 'backorder'
  language?: string
  isImport?: boolean
  metadata?: any
}

const LANG_MAP: Record<string, string> = {
    'English': 'Inglés', 'Spanish': 'Español', 'Japanese': 'Japonés',
    'Portuguese': 'Portugués', 'Italian': 'Italiano', 'German': 'Alemán',
    'French': 'Francés', 'Chinese': 'Chino', 'Russian': 'Ruso', 'Korean': 'Coreano'
}

export default function ProductCard(p: Props) {
  const currency = useStore((s) => s.currency)
  const { exchangeRate, enableImports } = useConfig()
  const cartItems = useCartStore((s) => s.items)
  const addItem = useCartStore((s) => s.addItem)
  const addQuote = useQuoteStore((s) => s.addItem)
  const toggleHangModal = useUIStore((s) => s.toggleHangModal)
  const supabase = createClient()

  const [wantsFoil, setWantsFoil] = useState(false)
  const [showAdded, setShowAdded] = useState(false)
  const [showWishlistModal, setShowWishlistModal] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  
  // Usamos el helper para resolver la URL correcta (local vs externa)
  const rawImage = p.image || p.image_url
  const mainImage = getCardImageUrl(rawImage)
  
  const gallery = Array.isArray(p.metadata?.gallery) ? p.metadata.gallery : []
  const allImages = [mainImage, ...gallery].filter(Boolean)
  const [activeImgIndex, setActiveImgIndex] = useState(0)
  
  const currentImage = allImages[activeImgIndex] || mainImage
  const hasMultipleImages = allImages.length > 1

  const showFoilBadge = (p.isImport ? wantsFoil : p.isFoil) || p.tcg === 'Secret Lair'
  const isMagic = p.tcg === 'Magic' || p.tcg === 'Secret Lair'
  const basePriceUsd = (showFoilBadge && p.priceUsdFoil) ? p.priceUsdFoil : p.priceUsd
  const price = currency === 'USD' ? basePriceUsd : Math.round(basePriceUsd * exchangeRate)
  const symbol = currency === 'USD' ? 'US$' : '$'

  const langLabel = LANG_MAP[p.language || 'English'] || p.language || 'Inglés'
  const finishLabel = (p.finish || 'Foil').toUpperCase().replace('NON-FOIL', '').trim() || 'FOIL'
  const hasImage = !!(p.image || p.image_url)

  const imageFoilClass = showFoilBadge 
    ? "after:content-[''] after:absolute after:inset-0 after:bg-[linear-gradient(115deg,transparent_25%,rgba(255,255,255,0.3)_45%,rgba(255,255,255,0.3)_55%,transparent_75%)] after:opacity-50 after:mix-blend-overlay after:pointer-events-none after:bg-[length:250%_250%] after:animate-foil-shimmer after:z-10"
    : ""

  const outerWrapperClass = showFoilBadge
    ? "relative p-[3px] rounded-xl bg-gradient-to-r from-pink-500 via-purple-500 to-cyan-500 animate-gradient-xy shadow-xl"
    : "rounded-xl border border-slate-200 bg-white shadow-sm hover:shadow-xl transition-all duration-300"

  const innerContentClass = showFoilBadge
    ? "bg-white rounded-[9px] h-full overflow-hidden flex flex-col w-full relative z-10" 
    : "h-full flex flex-col overflow-hidden relative"

  const handleAddToCart = () => {
    addItem({ ...p, imageUrl: currentImage, stock: p.stock, isFoil: showFoilBadge })
    setShowAdded(true)
    setTimeout(() => setShowAdded(false), 2000)
  }

  const handleWishlistClick = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const { data: { user } } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }))
    if (!user) { alert('Debes iniciar sesión para usar la Wishlist.'); return }
    setUserId(user.id)
    setShowWishlistModal(true)
  }

  return (
    <>
    <div className={`group h-full flex flex-col hover:-translate-y-1 transition-transform duration-300 ${outerWrapperClass}`} onMouseLeave={() => setActiveImgIndex(0)}>
      <div className={innerContentClass}>
        
        <div className={`absolute inset-0 z-50 bg-emerald-600/95 flex flex-col items-center justify-center text-white transition-all duration-500 ease-out backdrop-blur-sm ${showAdded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`}>
            <div className={`transform transition-all duration-500 ${showAdded ? 'scale-100' : 'scale-50'}`}><Check size={56} className="mb-2 drop-shadow-md"/></div>
            <span className="font-bold text-lg drop-shadow-md">¡Agregado!</span>
        </div>

        <div className="p-3 flex items-center justify-between z-10 flex-wrap max-[400px]:gap-1">
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-zinc-100 uppercase tracking-wider text-zinc-500 truncate max-[400px]:max-w-[50%] max-[400px]:text-[9px] max-[400px]:px-1.5">{p.tcg}</span>
            <button onClick={handleWishlistClick} className="ml-1 max-[400px]:ml-0 px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 hover:text-[#9D1B1B] hover:bg-red-50 transition-colors flex items-center gap-1 text-[10px] font-bold border border-slate-200 shadow-sm cursor-pointer max-[400px]:text-[9px] max-[400px]:px-1.5 max-[400px]:shrink-0" title="Avisarme cuando haya stock">
                <Bell size={10} className="stroke-[2.5]" /><span className="max-[400px]:hidden">Wishlist</span><span className="hidden max-[400px]:inline">Avisar</span>
            </button>
        </div>

        <Link href={`/product/${p.id}`} className="block relative overflow-hidden flex-1 w-full cursor-pointer">
            <div className={`rounded-md overflow-hidden mx-4 relative aspect-[3/4] bg-slate-100 shadow-inner ${imageFoilClass}`}>
                {hasImage ? (
                    <img
                    src={currentImage}
                    alt={p.name}
                    className={`absolute inset-0 w-full h-full object-cover transition-transform duration-700 ease-out ${!hasMultipleImages && 'group-hover:scale-110'} ${p.stock === 0 ? 'opacity-80 grayscale-[0.5]' : ''}`}
                    loading="lazy"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-300 text-xs">Sin Imagen</div>
                )}
                
                {hasMultipleImages && (
                    <div className="absolute bottom-10 left-0 right-0 flex justify-center gap-1.5 z-30" onClick={(e) => e.preventDefault()}>
                        {allImages.map((_, idx) => (
                            <button
                                key={idx}
                                onMouseEnter={() => setActiveImgIndex(idx)}
                                className={`w-2 h-2 rounded-full border border-black/20 transition-all ${idx === activeImgIndex ? 'bg-white scale-125 shadow-sm' : 'bg-white/50 hover:bg-white/80'}`}
                            />
                        ))}
                    </div>
                )}

                <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/70 to-transparent pt-6 z-20">
                    {p.availability === 'stock' ? (
                        <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/90 text-white shadow-sm backdrop-blur-sm">{p.stock} EN STOCK</span>
                    ) : (
                        <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/90 text-white shadow-sm backdrop-blur-sm">POR ENCARGO</span>
                    )}
                </div>
            </div>
        </Link>

        <div className="p-4 flex flex-col mt-auto w-full">
            <Link href={`/product/${p.id}`} className="block mb-1 cursor-pointer">
                <h4 className="font-bold text-slate-900 line-clamp-2 text-sm leading-tight hover:text-[#9D1B1B] transition-colors" title={p.name}>{p.name}</h4>
            </Link>
            <div className="text-xs text-slate-500 mb-3 flex items-center gap-1 max-[400px]:flex-wrap max-[400px]:gap-x-1 max-[400px]:gap-y-0.5">
                <span className="truncate max-w-[120px] max-[400px]:max-w-[100px]">{p.setName}</span>
                {p.collectorNumber && <span className="opacity-60">• #{p.collectorNumber}</span>}
            </div>

            <div className="flex flex-wrap gap-1.5 mb-3 items-center max-[400px]:gap-1">
                {!p.isImport && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border max-[400px]:text-[9px] ${p.condition === 'NM' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-amber-50 text-amber-700 border-amber-100'}`}>{p.condition}</span>
                )}
                {p.language && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100 uppercase max-[400px]:text-[9px]">{langLabel}</span>}
                {showFoilBadge && <span className="text-[10px] font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-purple-600 to-pink-600 bg-purple-50 px-1.5 py-0.5 rounded flex items-center gap-1 border border-purple-100 shadow-sm bg-white max-[400px]:text-[9px]"><Sparkles size={10} className="text-purple-500 max-[400px]:shrink-0"/> {finishLabel}</span>}
            </div>

            {p.isImport && (
                <div className="flex items-center justify-between bg-slate-50 p-2 rounded-lg mb-3 border border-slate-100 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => setWantsFoil(!wantsFoil)}>
                    <span className="text-xs font-bold text-slate-600 flex items-center gap-1">{wantsFoil ? <Sparkles size={12} className="text-purple-500"/> : null} {wantsFoil ? 'Versión Foil' : 'Versión Normal'}</span>
                    <button className={`relative w-8 h-4 rounded-full transition-colors duration-300 cursor-pointer ${wantsFoil ? 'bg-purple-500' : 'bg-slate-300'}`}>
                        <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow-sm transition-transform duration-300 ${wantsFoil ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                </div>
            )}

            <div className="mt-auto pt-3 border-t border-slate-100 max-[400px]:pt-2">
            {p.stock > 0 ? (
                <div className="flex items-end justify-between gap-2 max-[400px]:gap-1.5 flex-wrap">
                    <div className="flex flex-col min-w-0">
                        <span className="text-xs text-slate-400 font-medium leading-none mb-1 max-[400px]:text-[10px]">Precio</span>
                        <div className="font-extrabold text-[#9D1B1B] leading-none tracking-tight flex items-baseline gap-0.5 flex-wrap">
                            <span className="text-sm max-[400px]:text-xs">{symbol}</span>
                            <span className="text-lg max-[400px]:text-sm">{price.toFixed(2)}</span>
                        </div>
                    </div>
                    {cartItems.find((i) => i.id === p.id) ? (
                        <div className="shrink-0"><QuantitySelector productId={p.id} maxStock={p.stock} /></div>
                    ) : (
                        <button className="bg-[#1C1B22] hover:bg-slate-800 text-white px-2.5 py-2 rounded-lg font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-md hover:shadow-lg active:scale-95 cursor-pointer shrink-0 max-[400px]:px-2 max-[400px]:py-1.5 max-[400px]:text-[10px] ml-auto" onClick={handleAddToCart}>
                            <ShoppingCart className="h-4 w-4 shrink-0 max-[400px]:h-3.5 max-[400px]:w-3.5" /> 
                            <span className="max-[400px]:hidden">Agregar</span>
                        </button>
                    )}
                </div>
            ) : (
                <div className="flex flex-col gap-2">
                    {enableImports ? (
                        <>
                            <span className="text-xs font-medium text-slate-500 flex items-center gap-1 leading-tight max-[400px]:text-[10px]">🇯🇵 Podés pedirlas desde Japón. Sumalo a tu cotización para saber el precio y tiempo de entrega.</span>
                            <button className="w-full px-3 py-2 rounded-lg font-bold text-xs flex items-center justify-center gap-2 border border-[#9D1B1B] text-[#9D1B1B] hover:bg-[#9D1B1B] hover:text-white transition-colors cursor-pointer" onClick={(e) => { e.preventDefault(); e.stopPropagation(); const quoteName = wantsFoil ? `${p.name} (Foil)` : p.name; addQuote({ id: p.id, name: quoteName, setName: p.setName, image: currentImage, quantity: 1 }); toggleHangModal() }}>
                                Cotizar
                            </button>
                        </>
                    ) : (
                        <span className="text-xs font-medium text-slate-500 flex items-center justify-center py-2 bg-slate-50 rounded-lg border border-slate-100">Sin stock disponible</span>
                    )}
                </div>
            )}
            </div>
        </div>
      </div>
    </div>
    
    {showWishlistModal && userId && <WishlistModal product={{...p, isFoil: showFoilBadge}} userId={userId} onClose={() => setShowWishlistModal(false)} />}
    </>
  )
}
