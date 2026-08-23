"use client"
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { X, Bell, Loader2, CheckCircle } from 'lucide-react'

type Props = {
  product: any
  onClose: () => void
  userId: string
}

export default function WishlistModal({ product, onClose, userId }: Props) {
  const supabase = createClient()
  const [mode, setMode] = useState<'any' | 'specific'>('any')
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)

  const handleSave = async () => {
    setLoading(true)
    try {
      const isSpecific = mode === 'specific'

      if (isSpecific) {
        // 1. Verificamos si existe el producto EXACTO (ID + Finish)
        // El catálogo es de escritura administrativa. Si la variante aún no
        // está catalogada no podemos crearla desde el navegador; pedir una
        // alerta por nombre sigue disponible mediante "Cualquier Versión".
        const { data: exists, error: lookupError } = await supabase
          .from('products')
          .select('id')
          .eq('id', product.id)
          .maybeSingle()

        if (lookupError) throw lookupError
        if (!exists) {
          throw new Error('Esta versión todavía no está catalogada. Selecciona “Cualquier Versión” para crear una alerta por nombre.')
        }
      }

      // Payload para Wishlist
      const payload = {
        user_id: userId,
        card_name: product.name,
        product_id: isSpecific ? product.id : null,
        set_name: product.setName || product.set_name,
        image_url: product.image || product.image_url,
        is_specific: isSpecific,
        notified: false
      }

      let q = supabase.from('wishlists').select('id').eq('user_id', userId)
      if (isSpecific) {
        q = q.eq('product_id', product.id)
      } else {
        q = q.eq('card_name', product.name).eq('is_specific', false)
      }
      const { data: existing } = await q.maybeSingle()

      if (existing) {
        alert('¡Ya tienes esta alerta configurada!')
        onClose()
        return
      }

      const { error } = await supabase.from('wishlists').insert(payload)
      if (error) throw error

      setSaved(true)
      setTimeout(onClose, 1500)
    } catch (e: any) {
      console.error(e)
      alert('Error guardando alerta: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  if (saved) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in">
        <div className="bg-white rounded-xl p-8 flex flex-col items-center animate-in zoom-in-95">
          <CheckCircle className="w-16 h-16 text-emerald-500 mb-4" />
          <h3 className="text-xl font-bold text-slate-800">¡Alerta Creada!</h3>
          <p className="text-slate-500">Te avisaremos por email cuando haya stock.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in p-4">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4">
        <div className="bg-[#0F172A] p-4 flex justify-between items-center">
          <h3 className="text-white font-bold flex items-center gap-2">
            <Bell size={18} className="text-[#9D1B1B]" /> Crear Alerta de Stock
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>
        
        <div className="p-6">
          <div className="flex gap-4 mb-6 items-start">
            <div className="w-16 h-20 bg-slate-200 rounded shrink-0 overflow-hidden border border-slate-200">
                {(product.image || product.image_url) && (
                    <img src={product.image || product.image_url} className="w-full h-full object-cover" />
                )}
            </div>
            <div>
                <h4 className="font-bold text-slate-900">{product.name}</h4>
                <div className="text-xs text-slate-500 flex flex-col">
                    <span>{product.setName || product.set_name} #{product.collectorNumber || product.collector_number}</span>
                    {/* Feedback visual del acabado */}
                    {product.isFoil && <span className="text-purple-600 font-bold mt-1">✨ Versión Foil</span>}
                </div>
            </div>
          </div>

          <p className="text-sm font-bold text-slate-700 mb-3">¿Qué versión buscas?</p>
          
          <div className="space-y-3">
            <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${mode === 'any' ? 'border-[#9D1B1B] bg-red-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                <div className="mt-0.5">
                    <input type="radio" name="mode" checked={mode === 'any'} onChange={() => setMode('any')} className="accent-[#9D1B1B]" />
                </div>
                <div>
                    <span className="block font-bold text-slate-900 text-sm">Cualquier Versión</span>
                    <span className="block text-xs text-slate-500 leading-relaxed">Avísame si entra cualquier carta con nombre "{product.name}", sin importar edición, rareza o estado.</span>
                </div>
            </label>

            <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${mode === 'specific' ? 'border-[#9D1B1B] bg-red-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                <div className="mt-0.5">
                    <input type="radio" name="mode" checked={mode === 'specific'} onChange={() => setMode('specific')} className="accent-[#9D1B1B]" />
                </div>
                <div>
                    <span className="block font-bold text-slate-900 text-sm">Solo Esta Versión Exacta</span>
                    <span className="block text-xs text-slate-500 leading-relaxed">
                        Avísame SOLO si entra {product.setName} #{product.collectorNumber} 
                        {product.isFoil ? <strong> (FOIL)</strong> : ''}.
                    </span>
                </div>
            </label>
          </div>

          <button 
            onClick={handleSave} 
            disabled={loading}
            className="w-full mt-6 py-3 rounded-xl bg-[#0F172A] text-white font-bold hover:bg-slate-900 transition-all flex items-center justify-center gap-2 shadow-lg shadow-slate-900/20 disabled:opacity-50"
          >
            {loading ? <Loader2 className="animate-spin" size={18} /> : <Bell size={18} />}
            Crear Alerta
          </button>
        </div>
      </div>
    </div>
  )
}
