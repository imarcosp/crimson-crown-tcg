"use client"
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Save, Plus, Trash2, Loader2 } from 'lucide-react'

export default function AdminSettings() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [info, setInfo] = useState({
    contact_whatsapp: '',
    contact_instagram: '',
    contact_email: '',
    contact_address: '',
    contact_address_note: '',
    contact_schedule: '',
    store_description: ''
  })

  const [faqs, setFaqs] = useState<any[]>([])
  const [newFaq, setNewFaq] = useState({ question: '', answer: '', display_order: 0 })

  useEffect(() => {
    const fetchData = async () => {
      try {
        const cleanValue = (val: any) => {
          if (typeof val === 'string' && val.startsWith('"') && val.endsWith('"')) {
            try { return JSON.parse(val) } catch { return val.slice(1, -1) }
          }
          return val
        }
        const { data: settings } = await supabase.from('system_settings').select('*')
        if (settings) {
          const next: any = { ...info }
          settings.forEach((item: any) => {
            const val = cleanValue(item.value)
            if (Object.prototype.hasOwnProperty.call(next, item.key)) next[item.key] = val
          })
          setInfo(next)
        }
        const { data: faqData } = await supabase.from('faqs').select('*').order('display_order', { ascending: true })
        if (faqData) setFaqs(faqData)
      } catch (error) {
        console.error(error)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  const handleSaveInfo = async () => {
    setSaving(true)
    try {
      const updates = Object.entries(info).map(([key, value]) => ({
        key,
        value: JSON.stringify(value),
        updated_at: new Date().toISOString()
      }))
      const { error } = await supabase.from('system_settings').upsert(updates)
      if (error) throw error
      alert('¡Información guardada correctamente!')
    } catch (e: any) {
      alert('Error al guardar: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleAddFaq = async () => {
    if (!newFaq.question || !newFaq.answer) return alert('Completa pregunta y respuesta')
    const { data, error } = await supabase.from('faqs').insert([newFaq]).select()
    if (!error && data) {
      setFaqs([...faqs, data[0]])
      setNewFaq({ question: '', answer: '', display_order: faqs.length * 10 + 10 })
    }
  }

  const handleDeleteFaq = async (id: number) => {
    if (!confirm('¿Borrar esta pregunta?')) return
    const { error } = await supabase.from('faqs').delete().eq('id', id)
    if (!error) setFaqs(faqs.filter(f => f.id !== id))
  }

  if (loading) return <div className="p-10 flex justify-center"><Loader2 className="animate-spin" /></div>

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <h1 className="text-3xl font-bold text-slate-800">Configuración del Sitio</h1>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">📝 Información General</h2>
        <div className="grid gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Descripción de la Tienda (Footer)</label>
            <textarea
              className="w-full border rounded p-2 text-sm"
              rows={2}
              value={info.store_description}
              onChange={e => setInfo({...info, store_description: e.target.value})}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">WhatsApp (Solo números)</label>
              <input className="w-full border rounded p-2 text-sm" value={info.contact_whatsapp} onChange={e => setInfo({...info, contact_whatsapp: e.target.value})} />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Email</label>
              <input className="w-full border rounded p-2 text-sm" value={info.contact_email} onChange={e => setInfo({...info, contact_email: e.target.value})} />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Instagram (URL Completa)</label>
              <input className="w-full border rounded p-2 text-sm" value={info.contact_instagram} onChange={e => setInfo({...info, contact_instagram: e.target.value})} />
            </div>
          </div>
          <div className="border-t pt-4 mt-2">
             <h3 className="font-bold text-sm mb-3">Dirección y Horarios</h3>
             <div className="grid gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Dirección Principal</label>
                  <input className="w-full border rounded p-2 text-sm" value={info.contact_address} onChange={e => setInfo({...info, contact_address: e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Aclaración Dirección (Entre paréntesis)</label>
                  <input className="w-full border rounded p-2 text-sm" value={info.contact_address_note} onChange={e => setInfo({...info, contact_address_note: e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Horarios de Atención</label>
                  <input className="w-full border rounded p-2 text-sm" value={info.contact_schedule} onChange={e => setInfo({...info, contact_schedule: e.target.value})} />
                </div>
             </div>
          </div>
          <button
            onClick={handleSaveInfo}
            disabled={saving}
            className="mt-4 bg-[#0F172A] text-white px-4 py-2 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-black transition-colors"
          >
            {saving ? <Loader2 className="animate-spin h-4 w-4"/> : <Save className="h-4 w-4"/>}
            Guardar Información
          </button>
        </div>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">❓ Preguntas Frecuentes</h2>
        <div className="bg-slate-50 p-4 rounded-lg mb-6 grid gap-3">
           <input placeholder="Nueva Pregunta" className="border rounded p-2 text-sm" value={newFaq.question} onChange={e => setNewFaq({...newFaq, question: e.target.value})} />
           <textarea placeholder="Respuesta" className="border rounded p-2 text-sm" rows={2} value={newFaq.answer} onChange={e => setNewFaq({...newFaq, answer: e.target.value})} />
           <div className="flex justify-end">
             <button onClick={handleAddFaq} className="bg-emerald-600 text-white px-3 py-1.5 rounded text-sm font-bold flex items-center gap-2"><Plus size={16}/> Agregar Pregunta</button>
           </div>
        </div>

        <div className="space-y-2">
          {faqs.map((f) => (
            <div key={f.id} className="flex justify-between items-start p-3 border rounded hover:bg-slate-50">
              <div>
                <p className="font-bold text-sm text-slate-800">{f.question}</p>
                <p className="text-xs text-slate-500 mt-1">{f.answer}</p>
              </div>
              <button onClick={() => handleDeleteFaq(f.id)} className="text-red-500 hover:bg-red-50 p-1 rounded"><Trash2 size={16}/></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
