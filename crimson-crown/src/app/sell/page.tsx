"use client"
import Link from 'next/link'
import { ArrowRight, CheckCircle, Info, Upload, Sparkles } from 'lucide-react'

export default function SellPage() {
  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      {/* HERO SECTION */}
      <div className="bg-[#0F172A] text-white py-20 px-4 text-center">
        <h1 className="text-4xl md:text-5xl font-extrabold mb-4">Véndenos tus cartas</h1>
        <p className="text-slate-300 text-lg max-w-2xl mx-auto">Convertí tus cartas en crédito para la tienda y comprá lo que realmente querés.</p>
      </div>

      <div className="container mx-auto px-4 -mt-10">
        
        {/* INFO CARDS */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            <div className="bg-white p-6 rounded-xl shadow-lg border border-slate-100 flex flex-col items-center text-center">
                <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600 mb-4"><CheckCircle size={24}/></div>
                <h3 className="font-bold text-lg mb-2">Cotización Justa</h3>
                <p className="text-slate-500 text-sm">Ofrecemos hasta un <strong>75% del valor de mercado</strong> en créditos de tienda.</p>
            </div>
            <div className="bg-white p-6 rounded-xl shadow-lg border border-slate-100 flex flex-col items-center text-center">
                <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 mb-4"><Info size={24}/></div>
                <h3 className="font-bold text-lg mb-2">Revisión Física</h3>
                <p className="text-slate-500 text-sm">El precio final depende del estado (NM/PL). Revisamos las cartas para una cotización mas precisa.</p>
            </div>
            <div className="bg-white p-6 rounded-xl shadow-lg border border-slate-100 flex flex-col items-center text-center">
                <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center text-purple-600 mb-4"><Upload size={24}/></div>
                <h3 className="font-bold text-lg mb-2">Crédito Instantáneo</h3>
                <p className="text-slate-500 text-sm">Usa tus créditos para comprar stock local o hacer pedidos de importación.</p>
            </div>
        </div>

        {/* MÉTODOS DE CARGA */}
        <h2 className="text-2xl font-bold text-slate-800 mb-6 text-center">¿Cómo querés cargar tu lista?</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
            {/* MANUAL */}
            <Link href="/buylist" className="group bg-white p-8 rounded-2xl border-2 border-slate-200 hover:border-[#9D1B1B] transition-all hover:shadow-xl cursor-pointer relative overflow-hidden">
                <div className="absolute top-0 right-0 bg-slate-100 px-3 py-1 text-[10px] font-bold uppercase rounded-bl-lg text-slate-500">Recomendado</div>
                <h3 className="text-xl font-bold text-slate-800 mb-2 group-hover:text-[#9D1B1B] transition-colors">Carga Manual</h3>
                <p className="text-slate-500 text-sm mb-6">Busca carta por carta en nuestro sistema. Ideal para pocas cartas.</p>
                <p className="text-slate-500 text-sm mb-6">Recuerda seleccionar la versión correcta de cada carta que vendes asi como si es foil o no foil.</p>
                <span className="flex items-center gap-2 text-sm font-bold text-[#9D1B1B]">Comenzar <ArrowRight size={16}/></span>
            </Link>

            {/* AUTOMÁTICO (ACTIVADO) */}
            <Link href="/sell/import" className="group bg-white p-8 rounded-2xl border-2 border-slate-200 hover:border-purple-600 transition-all hover:shadow-xl cursor-pointer relative overflow-hidden">
                <div className="absolute top-0 right-0 bg-purple-100 px-3 py-1 text-[10px] font-bold uppercase rounded-bl-lg text-purple-600 flex items-center gap-1"><Sparkles size={10}/> Nuevo</div>
                <h3 className="text-xl font-bold text-slate-800 mb-2 group-hover:text-purple-600 transition-colors">Importar Lista</h3>
                <p className="text-slate-500 text-sm mb-6">Pega tu link de Moxfield. Detectaremos las versiones exactas y cotizaremos todo junto.</p>
                <span className="flex items-center gap-2 text-sm font-bold text-purple-600">Probar Importador <ArrowRight size={16}/></span>
            </Link>
        </div>

      </div>
    </div>
  )
}