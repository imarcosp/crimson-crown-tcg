import Link from 'next/link'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { CheckCircle, AlertCircle, Clock } from 'lucide-react'
import PaymentVerifier from '@/components/cart/PaymentVerifier'

export default async function SuccessPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const cookieStore = await cookies()
  
  // Instancia de Supabase para Server Component
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get(name: string) { return cookieStore.get(name)?.value }, set(name: string, value: string, options: any) { try { cookieStore.set({ name, value, ...options }) } catch (error) {} }, remove(name: string, options: any) { try { cookieStore.set({ name, value: '', ...options }) } catch (error) {} }, }, }
  )

  // Obtener detalles de la orden para personalizar el mensaje
  const { data: order } = await supabase
    .from('orders')
    .select('payment_method, delivery_method, total_amount')
    .eq('id', id)
    .single()

  const isTransfer = order?.payment_method === 'transferencia' || order?.payment_method === 'wire' || order?.delivery_method?.includes('Transf')
  const isCash = order?.payment_method === 'efectivo' || order?.payment_method === 'cash' || order?.delivery_method?.includes('Efectivo')
  const isMercadoPago = order?.delivery_method?.includes('Mercado Pago') || order?.payment_method === 'mercadopago'

  return (
    <div className="min-h-[60vh] grid place-items-center p-4">
      <div className="max-w-lg w-full bg-white rounded-2xl border border-slate-200 shadow-xl p-8 text-center">
        <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle size={40} />
        </div>
        
        <h1 className="text-3xl font-extrabold text-[#1C1B22] mb-2">¡Pedido Realizado!</h1>
        <p className="text-slate-500 font-mono text-sm mb-6">Orden #{id.slice(0,8)}</p>

        <PaymentVerifier orderId={id} isMercadoPago={isMercadoPago} />
        
        <div className="bg-slate-50 p-6 rounded-xl border border-slate-100 mb-6 text-left">
            <h3 className="font-bold text-slate-800 mb-2 flex items-center gap-2">
                <Clock size={18} className="text-[#9D1B1B]"/> Información Importante:
            </h3>
            
            {isCash && (
                <p className="text-slate-600 text-sm leading-relaxed">
                    Elegiste pago en <strong>Efectivo</strong>. Tenés <strong>3 días hábiles</strong> para retirar tu pedido por el local y abonarlo. Pasado este tiempo, la reserva expirará.
                </p>
            )}

            {isTransfer && (
                <p className="text-slate-600 text-sm leading-relaxed">
                    Elegiste <strong>Transferencia Bancaria</strong>. Por favor realiza el pago y carga el comprobante. Si no se recibe el pago en <strong>3 días hábiles</strong>, la compra se cancelará automáticamente.
                </p>
            )}

            {!isCash && !isTransfer && (
                <p className="text-slate-600 text-sm leading-relaxed">
                    Hemos recibido tu pedido correctamente, te recordamos que si el pago es por transferencia tienes <strong>3 días hábiles</strong> para realizarlo. Pasado este tiempo, la compra se cancelará automáticamente. <br /><br /> Si el pago es en efectivo tienes <strong>3 días habíles</strong> para retirarlo. Pasado este tiempo, la compra se cancelará automáticamente. 
                </p>
            )}
        </div>

        <div className="flex flex-col gap-3">
            <p className="text-xs text-slate-400 mb-2">
                Para ver los datos de pago (CBU/Alias) y subir tu comprobante, andá a tus pedidos:
            </p>
            <Link href="/profile?tab=stock" className="w-full inline-block rounded-xl bg-[#9D1B1B] hover:bg-[#7E1515] text-white px-6 py-4 text-base font-bold shadow-lg transition-all">
                Ver Mis Pedidos
            </Link>
            <Link href="/" className="text-slate-500 hover:text-slate-800 text-sm font-medium py-2">
                Volver al inicio
            </Link>
        </div>
      </div>
    </div>
  )
}
