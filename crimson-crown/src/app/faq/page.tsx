import { createClient as createServerSupabase } from '@/lib/supabase/server'

export default async function FAQPage() {
  const supabase = await createServerSupabase()
  const { data } = await supabase.from('faqs').select('id, question, answer, display_order').order('display_order', { ascending: true })
  const faqs = Array.isArray(data) ? data : []
  return (
    <div className="container mx-auto py-12 px-4 max-w-3xl">
      <h1 className="text-3xl font-bold text-[#0F172A] mb-2">Preguntas Frecuentes</h1>
      <p className="text-slate-500 mb-8">Todo lo que necesitas saber sobre compras, envíos y ventas.</p>
      <div className="space-y-4">
        {faqs.length > 0 ? faqs.map((f: any) => (
          <div key={f.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <details className="group">
              <summary className="flex justify-between items-center font-bold cursor-pointer list-none p-4 bg-slate-50 hover:bg-slate-100 transition-colors">
                <span>{f.question}</span>
                <span className="transition group-open:rotate-180">
                  <svg fill="none" height="24" shapeRendering="geometricPrecision" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 24 24" width="24"><path d="M6 9l6 6 6-6"></path></svg>
                </span>
              </summary>
              <div className="text-slate-600 p-4 border-t border-slate-200">
                <p className="whitespace-pre-line">{f.answer}</p>
              </div>
            </details>
          </div>
        )) : (
          <div className="bg-white rounded-xl border border-slate-200 p-6 text-slate-600">No hay preguntas frecuentes cargadas.</div>
        )}
      </div>
    </div>
  )
}
