"use client"
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useUIStore } from '@/store/uiStore'
import { Search, ShoppingCart, Plane, Banknote, HelpCircle, ArrowRight, CheckCircle, Package, Truck, Sparkles, FileText, List } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { DEFAULT_HOW_TO_CONTENT, parseHowToContent, type HowToContent } from '@/lib/howToContent'

export default function HowToPage() {
  // Hook para abrir el modal desde el botón
  const toggleHangModal = useUIStore((s) => s.toggleHangModal)
  const supabase = createClient()
  const [content, setContent] = useState<HowToContent>(DEFAULT_HOW_TO_CONTENT)

  useEffect(() => {
    let mounted = true

    const loadHowToContent = async () => {
      try {
        const { data } = await supabase
          .from('system_settings')
          .select('value')
          .eq('key', 'how_to_content')
          .maybeSingle()

        if (!mounted || !data?.value) return
        setContent(parseHowToContent(data.value))
      } catch (error) {
        console.error('Error cargando contenido de how-to:', error)
      }
    }

    loadHowToContent()

    return () => {
      mounted = false
    }
  }, [supabase])

  return (
    <div className="bg-slate-50 min-h-screen pb-20">
      
      {/* HERO SECTION */}
      <div className="bg-[#1C1B22] text-white py-16 px-4 text-center relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
            <Sparkles className="absolute top-10 left-10 text-white w-20 h-20" />
            <Sparkles className="absolute bottom-10 right-10 text-white w-32 h-32" />
        </div>
        <h1 className="text-4xl md:text-5xl font-extrabold mb-4 tracking-tight">
          {content.heroTitleStart} <span className="text-[#9D1B1B]">{content.heroTitleHighlight}</span>{content.heroTitleEnd}
        </h1>
        <p className="text-slate-300 max-w-2xl mx-auto text-lg">
          {content.heroDescription}
        </p>
      </div>

      <div className="container mx-auto px-4 -mt-8 grid gap-8 max-w-5xl">
        
        {/* 1. COMPRAR STOCK */}
        <section className="bg-white rounded-2xl p-8 shadow-xl border border-slate-100 relative overflow-hidden group hover:border-[#9D1B1B]/30 transition-all">
            <div className="absolute top-0 right-0 bg-slate-100 px-4 py-2 rounded-bl-2xl font-bold text-slate-500 text-xs uppercase">{content.stock.badge}</div>
            <div className="flex flex-col md:flex-row gap-8 items-center">
                <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center shrink-0">
                    <ShoppingCart size={32} />
                </div>
                <div className="flex-1">
                    <h2 className="text-2xl font-bold text-slate-800 mb-2">{content.stock.title}</h2>
                    <p className="text-slate-600 mb-4">
                        {content.stock.description}
                    </p>
                    <ul className="space-y-2 mb-6">
                        {content.stock.bullets.map((bullet, index) => (
                          <li key={index} className="flex items-center gap-2 text-sm text-slate-500"><CheckCircle size={16} className="text-emerald-500"/> {bullet}</li>
                        ))}
                    </ul>
                    <Link href={content.stock.ctaHref || '/catalog'} className="inline-flex items-center gap-2 text-blue-600 font-bold hover:gap-3 transition-all">
                        {content.stock.ctaLabel} <ArrowRight size={16}/>
                    </Link>
                </div>
            </div>
        </section>

        {/* 2. IMPORTACIÓN MANUAL (COLGAR PEDIDO) */}
        <section className="bg-white rounded-2xl p-8 shadow-xl border border-[#9D1B1B]/20 relative overflow-hidden group">
            <div className="absolute top-0 right-0 bg-[#9D1B1B] text-white px-4 py-2 rounded-bl-2xl font-bold text-xs uppercase">{content.imports.badge}</div>
            <div className="flex flex-col md:flex-row gap-8 items-center">
                <div className="w-16 h-16 bg-red-50 text-[#9D1B1B] rounded-2xl flex items-center justify-center shrink-0">
                    <Plane size={32} />
                </div>
                <div className="flex-1">
                    <h2 className="text-2xl font-bold text-slate-800 mb-2">{content.imports.title}</h2>
                    <p className="text-slate-600 mb-4">
                        {content.imports.description}
                    </p>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                        {(content.imports.steps || []).map((step, index) => {
                          const StepIcon = index === 0 ? Search : index === 1 ? Banknote : Truck
                          return (
                            <div key={index} className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                                <StepIcon className="text-slate-400 mb-2" size={20}/>
                                <h4 className="font-bold text-slate-700 text-sm">{step.title}</h4>
                                <p className="text-xs text-slate-500">{step.description}</p>
                            </div>
                          )
                        })}
                    </div>

                    <button 
                        onClick={toggleHangModal} 
                        className="inline-flex items-center gap-2 text-[#9D1B1B] font-bold hover:gap-3 transition-all cursor-pointer"
                    >
                        {content.imports.ctaLabel} <ArrowRight size={16}/>
                    </button>
                </div>
            </div>
        </section>

        {/* 3. IMPORTADOR MOXFIELD (NUEVA SECCIÓN) */}
        <section className="bg-white rounded-2xl p-8 shadow-xl border border-purple-100 relative overflow-hidden group hover:border-purple-300 transition-all">
            <div className="absolute top-0 right-0 bg-purple-100 text-purple-700 px-4 py-2 rounded-bl-2xl font-bold text-xs uppercase">{content.moxfield.badge}</div>
            <div className="flex flex-col md:flex-row gap-8 items-center">
                <div className="w-16 h-16 bg-purple-50 text-purple-600 rounded-2xl flex items-center justify-center shrink-0">
                    <List size={32} />
                </div>
                <div className="flex-1">
                    <h2 className="text-2xl font-bold text-slate-800 mb-2">{content.moxfield.title}</h2>
                    <p className="text-slate-600 mb-4">
                        {content.moxfield.description}
                    </p>
                    <ul className="space-y-2 mb-6">
                        {content.moxfield.bullets.map((bullet, index) => (
                          <li key={index} className="flex items-center gap-2 text-sm text-slate-500">
                              <CheckCircle size={16} className="text-purple-500"/> 
                              {bullet}
                          </li>
                        ))}
                    </ul>
                    <Link href={content.moxfield.ctaHref || '/tools/moxfield'} className="inline-flex items-center gap-2 text-purple-600 font-bold hover:gap-3 transition-all">
                        {content.moxfield.ctaLabel} <ArrowRight size={16}/>
                    </Link>
                </div>
            </div>
        </section>

        {/* 4. VENDER (BUYLIST) */}
        <section className="bg-white rounded-2xl p-8 shadow-xl border border-slate-100 relative overflow-hidden group hover:border-emerald-500/30 transition-all">
            <div className="absolute top-0 right-0 bg-slate-100 px-4 py-2 rounded-bl-2xl font-bold text-slate-500 text-xs uppercase">{content.sell.badge}</div>
            <div className="flex flex-col md:flex-row gap-8 items-center">
                <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center shrink-0">
                    <Banknote size={32} />
                </div>
                <div className="flex-1">
                    <h2 className="text-2xl font-bold text-slate-800 mb-2">{content.sell.title}</h2>
                    <p className="text-slate-600 mb-4">
                        {content.sell.description}
                    </p>
                    <ul className="space-y-2 mb-6">
                        {content.sell.bullets.map((bullet, index) => (
                          <li key={index} className="flex items-center gap-2 text-sm text-slate-500"><CheckCircle size={16} className="text-emerald-500"/> {bullet}</li>
                        ))}
                    </ul>
                    <Link href={content.sell.ctaHref || '/sell'} className="inline-flex items-center gap-2 text-emerald-600 font-bold hover:gap-3 transition-all">
                        {content.sell.ctaLabel} <ArrowRight size={16}/>
                    </Link>
                </div>
            </div>
        </section>

        {/* FAQ */}
        <div className="mt-8 text-center">
            <h3 className="text-xl font-bold text-slate-800 mb-6 flex items-center justify-center gap-2">
                <HelpCircle className="text-slate-400"/> {content.faqTitle}
            </h3>
            <div className="grid md:grid-cols-2 gap-4 text-left">
                {content.faqs.map((faq, index) => (
                  <div key={index} className="bg-white p-5 rounded-xl shadow-sm border border-slate-100">
                      <h4 className="font-bold text-slate-800 mb-2 text-sm">{faq.question}</h4>
                      <p className="text-xs text-slate-500 leading-relaxed">{faq.answer}</p>
                  </div>
                ))}
            </div>
        </div>

      </div>
    </div>
  )
}
