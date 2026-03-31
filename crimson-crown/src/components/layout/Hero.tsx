"use client"
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useUIStore } from '@/store/uiStore'
import { useStore } from '@/store/useStore'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export default function Hero() {
  const supabase = createClient()
  const toggleHangModal = useUIStore((s) => s.toggleHangModal)
  const setSearchQuery = useStore((s) => s.setSearchQuery)

  const [banners, setBanners] = useState<any[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadBanners = async () => {
      const { data } = await supabase
        .from('banners')
        .select('*')
        .eq('active', true)
        .order('display_order', { ascending: true })
      if (data && data.length > 0) {
        setBanners(data)
      }
      setLoading(false)
    }
    loadBanners()
  }, [])

  useEffect(() => {
    if (banners.length <= 1) return
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % banners.length)
    }, 6000)
    return () => clearInterval(interval)
  }, [banners.length])

  const nextSlide = () => setCurrentIndex((prev) => (prev + 1) % banners.length)
  const prevSlide = () => setCurrentIndex((prev) => (prev - 1 + banners.length) % banners.length)

  const handleAction = (link?: string) => {
    if (!link) return
    if (link === '#stock') {
      setSearchQuery('')
      const el = document.getElementById('products')
      if (el) window.scrollTo({ top: el.offsetTop, behavior: 'smooth' })
    } else if (link === '#quote') {
      toggleHangModal()
    } else {
      window.open(link, '_blank')
    }
  }

  // Fallback si no hay banners
  if (!loading && banners.length === 0) {
    return (
      <section className="min-h-[400px] rounded-xl bg-gradient-to-r from-[#E91E63] to-[#C2185B] p-8 text-white relative overflow-hidden flex items-center">
        <div className="max-w-3xl relative z-10">
          <h1 className="text-4xl sm:text-5xl font-extrabold mb-4">Pedí esa carta que te falta.</h1>
          <p className="text-white/90 text-lg mb-8 max-w-xl">Stock local y pedidos internacionales. Cotizamos rápido y colgamos tu pedido.</p>
          <div className="flex flex-wrap gap-3">
            <button onClick={() => handleAction('#stock')} className="px-6 py-3 rounded-lg bg-[#0F172A] text-white font-bold shadow-lg hover:bg-slate-900 cursor-pointer">Ver Stock</button>
            <button onClick={() => handleAction('#quote')} className="px-6 py-3 rounded-lg bg-white text-[#E91E63] font-bold shadow-lg hover:bg-slate-50 cursor-pointer">Cotizar Pedido</button>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="relative w-full h-[500px] md:h-[450px] lg:h-[500px] rounded-xl overflow-hidden shadow-2xl bg-slate-900 group">
      {banners.map((banner, idx) => (
        <div
          key={banner.id ?? idx}
          className={`absolute inset-0 transition-opacity duration-1000 ease-in-out ${idx === currentIndex ? 'opacity-100 z-10' : 'opacity-0 z-0'}`}
        >
          {/* IMAGEN DE FONDO */}
          <div className="absolute inset-0">
            {/* TRUCO RESPONSIVE: 
                - Mobile: object-[75%] enfoca más a la derecha (personajes).
                - Desktop: object-center enfoca el centro.
            */}
            <img 
                src={banner.image_url} 
                alt={banner.title || 'Banner'} 
                className="w-full h-full object-cover object-[75%] md:object-center" 
            />
            
            {/* DEGRADADOS PARA LEGIBILIDAD */}
            {/* Mobile: Degradado fuerte desde abajo hacia arriba (para texto inferior) */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/50 to-transparent md:hidden" />
            
            {/* Desktop: Degradado lateral izquierda a derecha (diseño original) */}
            <div className="absolute inset-0 hidden md:block bg-gradient-to-r from-black/90 via-black/40 to-transparent" />
          </div>

          {/* CONTENIDO DE TEXTO (Superpuesto siempre) */}
          <div className="absolute inset-0 flex flex-col justify-end md:justify-center p-8 md:p-16 z-20">
            <div className="max-w-3xl">
                <h2 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold text-white mb-4 leading-tight drop-shadow-lg">
                    {banner.title}
                </h2>
                {banner.description && (
                <p className="text-base sm:text-xl text-slate-200 mb-8 max-w-xl leading-relaxed drop-shadow-md">
                    {banner.description}
                </p>
                )}
                {banner.button_text && (
                <button
                    onClick={() => handleAction(banner.link_url)}
                    className="w-full sm:w-fit px-8 py-4 rounded-xl bg-[#E91E63] hover:bg-pink-600 text-white font-bold text-lg shadow-xl hover:shadow-2xl hover:-translate-y-1 transition-all cursor-pointer"
                >
                    {banner.button_text}
                </button>
                )}
            </div>
          </div>
        </div>
      ))}

      {/* CONTROLES (Flechas) */}
      {banners.length > 1 && (
        <>
          <button
            onClick={prevSlide}
            className="absolute left-2 md:left-4 top-1/2 -translate-y-1/2 z-30 p-2 md:p-3 rounded-full bg-black/30 text-white/70 hover:bg-black/60 hover:text-white transition-all opacity-100 md:opacity-0 md:group-hover:opacity-100 cursor-pointer backdrop-blur-sm"
          >
            <ChevronLeft size={24} className="md:w-8 md:h-8" />
          </button>
          <button
            onClick={nextSlide}
            className="absolute right-2 md:right-4 top-1/2 -translate-y-1/2 z-30 p-2 md:p-3 rounded-full bg-black/30 text-white/70 hover:bg-black/60 hover:text-white transition-all opacity-100 md:opacity-0 md:group-hover:opacity-100 cursor-pointer backdrop-blur-sm"
          >
            <ChevronRight size={24} className="md:w-8 md:h-8" />
          </button>
          
          {/* INDICADORES (Puntitos) */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 md:left-16 md:translate-x-0 z-30 flex gap-2">
            {banners.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setCurrentIndex(idx)}
                className={`h-1.5 md:h-2 rounded-full transition-all ${idx === currentIndex ? 'bg-[#E91E63] w-6 md:w-8' : 'bg-white/50 hover:bg-white w-2 md:w-2'}`}
              />
            ))}
          </div>
        </>
      )}
    </section>
  )
}