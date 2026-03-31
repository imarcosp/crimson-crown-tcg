import Link from 'next/link'
import { Clock, ExternalLink } from 'lucide-react'

export default function CheckoutPendingPage() {
  return (
    <div className="min-h-[70vh] flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl border border-amber-100 p-8 text-center animate-in fade-in slide-in-from-bottom-4">
        <div className="w-20 h-20 bg-amber-50 text-amber-500 rounded-full flex items-center justify-center mx-auto mb-6">
          <Clock size={40} />
        </div>
        
        <h1 className="text-2xl font-black text-slate-900 mb-2">Pago Pendiente</h1>
        <p className="text-slate-500 mb-8">
          Tu pago está en proceso de revisión por Mercado Pago. <br/>
          (Si pagaste en efectivo vía Rapipago/PagoFácil, esto es normal).
        </p>

        <div className="bg-slate-50 rounded-xl p-4 mb-8 text-sm text-slate-600 text-left">
          <p>Tu orden ha sido registrada y el stock está reservado. En cuanto Mercado Pago nos confirme la acreditación del dinero, el estado de tu orden cambiará automáticamente a <strong>"Pagada"</strong>.</p>
        </div>

        <div className="flex flex-col gap-3">
          <Link 
            href="/profile/imports" 
            className="w-full bg-[#0F172A] text-white py-3 px-4 rounded-xl font-bold hover:bg-black transition-colors flex items-center justify-center gap-2"
          >
            <ExternalLink size={18} /> Ir a mis órdenes
          </Link>
          <Link 
            href="/catalog" 
            className="w-full bg-white text-slate-600 border border-slate-200 py-3 px-4 rounded-xl font-bold hover:bg-slate-50 transition-colors"
          >
            Volver a la tienda
          </Link>
        </div>
      </div>
    </div>
  )
}