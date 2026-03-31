import Link from 'next/link'
import { AlertCircle, ShoppingCart } from 'lucide-react'

export default function CheckoutFailurePage() {
  return (
    <div className="min-h-[70vh] flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl border border-red-100 p-8 text-center animate-in fade-in slide-in-from-bottom-4">
        <div className="w-20 h-20 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6">
          <AlertCircle size={40} />
        </div>
        
        <h1 className="text-2xl font-black text-slate-900 mb-2">Pago Rechazado</h1>
        <p className="text-slate-500 mb-8">
          Lo sentimos, tu pago no pudo ser procesado por Mercado Pago. <br/>
          <strong>La orden ha sido cancelada y los productos han vuelto al stock.</strong>
        </p>

        <div className="bg-slate-50 rounded-xl p-4 mb-8 text-sm text-slate-600 text-left">
          <p className="font-bold text-slate-800 mb-2">Posibles razones:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Fondos insuficientes en la tarjeta.</li>
            <li>La tarjeta bloqueó la transacción por seguridad.</li>
            <li>Error temporal de conexión con el banco.</li>
          </ul>
        </div>

        <div className="flex flex-col gap-3">
          <Link 
            href="/catalog" 
            className="w-full bg-[#9D1B1B] text-white py-3 px-4 rounded-xl font-bold hover:bg-[#7E1515] transition-colors flex items-center justify-center gap-2"
          >
            <ShoppingCart size={18} /> Volver a armar el carrito
          </Link>
          <Link 
            href="/profile/imports" 
            className="w-full bg-white text-slate-600 border border-slate-200 py-3 px-4 rounded-xl font-bold hover:bg-slate-50 transition-colors"
          >
            Ver mis órdenes
          </Link>
        </div>
      </div>
    </div>
  )
}
