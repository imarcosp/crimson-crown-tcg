"use client"
import Link from 'next/link'
import { useUIStore } from '@/store/uiStore'
import { Search, ShoppingCart, Plane, Banknote, HelpCircle, ArrowRight, CheckCircle, Package, Truck, Sparkles, FileText, List } from 'lucide-react'
import { siteConfig } from '@/config/site'

export default function HowToPage() {
  // Hook para abrir el modal desde el botón
  const toggleHangModal = useUIStore((s) => s.toggleHangModal)

  return (
    <div className="bg-slate-50 min-h-screen pb-20">
      
      {/* HERO SECTION */}
      <div className="bg-[#0F172A] text-white py-16 px-4 text-center relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
            <Sparkles className="absolute top-10 left-10 text-white w-20 h-20" />
            <Sparkles className="absolute bottom-10 right-10 text-white w-32 h-32" />
        </div>
        <h1 className="text-4xl md:text-5xl font-extrabold mb-4 tracking-tight">
          ¿Cómo funciona <span className="text-[#E91E63]">{siteConfig.shortName}</span>?
        </h1>
        <p className="text-slate-300 max-w-2xl mx-auto text-lg">
          Tu hub definitivo para TCGs. Compra stock, importa listas completas o véndenos tus cartas.
        </p>
      </div>

      <div className="container mx-auto px-4 -mt-8 grid gap-8 max-w-5xl">
        
        {/* 1. COMPRAR STOCK */}
        <section className="bg-white rounded-2xl p-8 shadow-xl border border-slate-100 relative overflow-hidden group hover:border-[#E91E63]/30 transition-all">
            <div className="absolute top-0 right-0 bg-slate-100 px-4 py-2 rounded-bl-2xl font-bold text-slate-500 text-xs uppercase">Lo clásico</div>
            <div className="flex flex-col md:flex-row gap-8 items-center">
                <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center shrink-0">
                    <ShoppingCart size={32} />
                </div>
                <div className="flex-1">
                    <h2 className="text-2xl font-bold text-slate-800 mb-2">1. Compra Stock Local</h2>
                    <p className="text-slate-600 mb-4">
                        Explora nuestro catálogo de cartas que ya tenemos físicamente en Argentina. Sin esperas, despacho inmediato.
                    </p>
                    <ul className="space-y-2 mb-6">
                        <li className="flex items-center gap-2 text-sm text-slate-500"><CheckCircle size={16} className="text-emerald-500"/> Envíos a todo el país.</li>
                        <li className="flex items-center gap-2 text-sm text-slate-500"><CheckCircle size={16} className="text-emerald-500"/> Enviós gratis en pedidos mayores a 75 USD.</li>
                    </ul>
                    <Link href="/catalog" className="inline-flex items-center gap-2 text-blue-600 font-bold hover:gap-3 transition-all">
                        Ver Catálogo <ArrowRight size={16}/>
                    </Link>
                </div>
            </div>
        </section>

        {/* 2. IMPORTACIÓN MANUAL (COLGAR PEDIDO) */}
        <section className="bg-white rounded-2xl p-8 shadow-xl border border-[#E91E63]/20 relative overflow-hidden group">
            <div className="absolute top-0 right-0 bg-[#E91E63] text-white px-4 py-2 rounded-bl-2xl font-bold text-xs uppercase">Especialidad</div>
            <div className="flex flex-col md:flex-row gap-8 items-center">
                <div className="w-16 h-16 bg-pink-50 text-[#E91E63] rounded-2xl flex items-center justify-center shrink-0">
                    <Plane size={32} />
                </div>
                <div className="flex-1">
                    <h2 className="text-2xl font-bold text-slate-800 mb-2">2. Pedidos al Exterior (Manual)</h2>
                    <p className="text-slate-600 mb-4">
                        ¿Buscas cartas específicas? Usa nuestro buscador integrado con precios de Card Kingdom y Coolstuffinc para cotizar al instante.
                    </p>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                        <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                            <Search className="text-slate-400 mb-2" size={20}/>
                            <h4 className="font-bold text-slate-700 text-sm">1. Busca</h4>
                            <p className="text-xs text-slate-500">Busca carta por carta y selecciona la versión (Foil/Normal).</p>
                        </div>
                        <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                            <Banknote className="text-slate-400 mb-2" size={20}/>
                            <h4 className="font-bold text-slate-700 text-sm">2. Cotiza</h4>
                            <p className="text-xs text-slate-500">Precio final en dólares con impuestos y envío incluidos.</p>
                        </div>
                        <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                            <Truck className="text-slate-400 mb-2" size={20}/>
                            <h4 className="font-bold text-slate-700 text-sm">3. Recibe</h4>
                            <p className="text-xs text-slate-500">Llega en aprox. 15-20 días a nuestras manos.</p>
                        </div>
                    </div>

                    <button 
                        onClick={toggleHangModal} 
                        className="inline-flex items-center gap-2 text-[#E91E63] font-bold hover:gap-3 transition-all cursor-pointer"
                    >
                        Colgar pedido al exterior <ArrowRight size={16}/>
                    </button>
                </div>
            </div>
        </section>

        {/* 3. IMPORTADOR MOXFIELD (NUEVA SECCIÓN) */}
        <section className="bg-white rounded-2xl p-8 shadow-xl border border-purple-100 relative overflow-hidden group hover:border-purple-300 transition-all">
            <div className="absolute top-0 right-0 bg-purple-100 text-purple-700 px-4 py-2 rounded-bl-2xl font-bold text-xs uppercase">Automático</div>
            <div className="flex flex-col md:flex-row gap-8 items-center">
                <div className="w-16 h-16 bg-purple-50 text-purple-600 rounded-2xl flex items-center justify-center shrink-0">
                    <List size={32} />
                </div>
                <div className="flex-1">
                    <h2 className="text-2xl font-bold text-slate-800 mb-2">3. Importá tu lista de Moxfield</h2>
                    <p className="text-slate-600 mb-4">
                        ¿Tienes un mazo commander armado en Moxfield? No busques carta por carta. Pega el link y nuestra herramienta inteligente hará el trabajo sucio.
                    </p>
                    <ul className="space-y-2 mb-6">
                        <li className="flex items-center gap-2 text-sm text-slate-500">
                            <CheckCircle size={16} className="text-purple-500"/> 
                            Detecta automáticamente qué cartas ya tenemos en <strong>Stock Local</strong> (compra inmediata).
                        </li>
                        <li className="flex items-center gap-2 text-sm text-slate-500">
                            <CheckCircle size={16} className="text-purple-500"/> 
                            Separa las cartas que faltan y te permite cotizarlas para <strong>Importación</strong> en un clic.
                        </li>
                        <li className="flex items-center gap-2 text-sm text-slate-500">
                            <CheckCircle size={16} className="text-purple-500"/> 
                            Respeta ediciones y foils de tu lista original.
                        </li>
                    </ul>
                    <Link href="/tools/moxfield" className="inline-flex items-center gap-2 text-purple-600 font-bold hover:gap-3 transition-all">
                        Ir al Importador de Mazos <ArrowRight size={16}/>
                    </Link>
                </div>
            </div>
        </section>

        {/* 4. VENDER (BUYLIST) */}
        <section className="bg-white rounded-2xl p-8 shadow-xl border border-slate-100 relative overflow-hidden group hover:border-emerald-500/30 transition-all">
            <div className="absolute top-0 right-0 bg-slate-100 px-4 py-2 rounded-bl-2xl font-bold text-slate-500 text-xs uppercase">Crédito</div>
            <div className="flex flex-col md:flex-row gap-8 items-center">
                <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center shrink-0">
                    <Banknote size={32} />
                </div>
                <div className="flex-1">
                    <h2 className="text-2xl font-bold text-slate-800 mb-2">4. Véndenos tus cartas</h2>
                    <p className="text-slate-600 mb-4">
                        Convierte las cartas que no usas en crédito para comprar nuevas (o impórtarlas). 
                        Pagamos un % competitivo del valor de mercado.
                    </p>
                    <ul className="space-y-2 mb-6">
                        <li className="flex items-center gap-2 text-sm text-slate-500"><CheckCircle size={16} className="text-emerald-500"/> Cotización rápida.</li>
                        <li className="flex items-center gap-2 text-sm text-slate-500"><CheckCircle size={16} className="text-emerald-500"/> Bonus extra si eliges crédito en tienda.</li>
                    </ul>
                    <Link href="/sell" className="inline-flex items-center gap-2 text-emerald-600 font-bold hover:gap-3 transition-all">
                        Ir a la Buylist <ArrowRight size={16}/>
                    </Link>
                </div>
            </div>
        </section>

        {/* FAQ */}
        <div className="mt-8 text-center">
            <h3 className="text-xl font-bold text-slate-800 mb-6 flex items-center justify-center gap-2">
                <HelpCircle className="text-slate-400"/> Preguntas Frecuentes
            </h3>
            <div className="grid md:grid-cols-2 gap-4 text-left">
                <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-100">
                    <h4 className="font-bold text-slate-800 mb-2 text-sm">¿Cuánto tarda un pedido al exterior?</h4>
                    <p className="text-xs text-slate-500 leading-relaxed">Hacemos pedidos Lunes, Miercoles y Viernes. Una vez cerrado, tarda aproximadamente 15 a 20 días en llegar a Argentina y estar listo para despachar.</p>
                </div>
                <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-100">
                    <h4 className="font-bold text-slate-800 mb-2 text-sm">¿Qué métodos de pago aceptan?</h4>
                    <p className="text-xs text-slate-500 leading-relaxed">Aceptamos transferencia bancaria en pesos (cotización cripto del día), USDT (Cripto) y Efectivo.</p>
                </div>
                <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-100">
                    <h4 className="font-bold text-slate-800 mb-2 text-sm">¿Hacen envíos al interior?</h4>
                    <p className="text-xs text-slate-500 leading-relaxed">¡Sí! Despachamos a todo el país mediante Correo Argentino. El costo de envío corre por cuenta del comprador.</p>
                </div>
                <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-100">
                    <h4 className="font-bold text-slate-800 mb-2 text-sm">¿Las cartas en stock son reales?</h4>
                    <p className="text-xs text-slate-500 leading-relaxed">Sí, todo lo que ves en la sección "MTG Singles" o "Riftbound" está en nuestras carpetas listo para salir.</p>
                </div>
            </div>
        </div>

      </div>
    </div>
  )
}