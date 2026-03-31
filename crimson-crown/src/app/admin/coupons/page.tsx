"use client"
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Save, Trash2 } from 'lucide-react'

type Coupon = {
  id?: string
  code: string
  type: 'percentage' | 'fixed'
  value: number
  active?: boolean
  created_at?: string
}

export default function AdminCouponsPage() {
  const supabase = createClient()
  const [coupons, setCoupons] = useState<Coupon[]>([])
  const [loading, setLoading] = useState(true)

  const [form, setForm] = useState<Coupon>({ code: '', type: 'percentage', value: 0, active: true })
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetchCoupons() }, [])

  const fetchCoupons = async () => {
    setLoading(true)
    const { data, error } = await supabase.from('coupons').select('*').order('created_at', { ascending: false })
    if (!error) setCoupons(data || [])
    setLoading(false)
  }

  const handleCreate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const codeUpper = form.code.toUpperCase().trim()
    if (!codeUpper) { alert('El código es obligatorio'); return }
    const val = parseFloat(form.value.toString())
    if (isNaN(val) || val <= 0) { alert('El valor debe ser un número positivo'); return }
    setSaving(true)
    try {
      const { data, error } = await supabase
        .from('coupons')
        .insert({
          code: codeUpper,
          discount_type: form.type,
          value: val,
          active: form.active ?? true,
        })
        .select()
      if (error) {
        console.error('Error Supabase:', error)
        throw error
      }
      alert('¡Cupón creado con éxito!')
      await fetchCoupons()
      setForm({ code: '', type: 'percentage', value: 0, active: true })
    } catch (err: any) {
      alert(`Error creando cupón: ${err?.message || JSON.stringify(err)}`)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id?: string) => {
    if (!id) return
    const { error } = await supabase.from('coupons').delete().eq('id', id)
    if (error) alert('Error borrando cupón')
    else { await fetchCoupons(); alert('Cupón eliminado') }
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6 text-slate-800">Gestor de Cupones</h1>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 max-w-xl mb-8">
        <h2 className="text-lg font-bold text-slate-900 mb-2">Crear Cupón</h2>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <input
              type="text"
              placeholder="CÓDIGO"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              className="border border-slate-300 rounded px-3 py-2 w-40 uppercase"
            />
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as Coupon['type'] })}
              className="border border-slate-300 rounded px-3 py-2"
            >
              <option value="percentage">Porcentaje</option>
              <option value="fixed">Fijo</option>
            </select>
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="Valor"
              value={form.value}
              onChange={(e) => setForm({ ...form, value: Number(e.target.value) })}
              className="border border-slate-300 rounded px-3 py-2 w-32"
            />
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={!!form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              Activo
            </label>
            <button
              onClick={(e) => handleCreate(e)}
              disabled={saving}
              className="inline-flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-lg text-sm font-bold"
            >
              <Save size={16} /> Guardar
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
            <tr>
              <th className="p-4">Código</th>
              <th className="p-4">Tipo</th>
              <th className="p-4">Valor</th>
              <th className="p-4">Estado</th>
              <th className="p-4">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td className="p-4" colSpan={5}>Cargando...</td></tr>
            ) : coupons.length ? (
              coupons.map((c) => (
                <tr key={c.id}>
                  <td className="p-4 font-mono font-bold">{c.code}</td>
                  <td className="p-4">{c.type}</td>
                  <td className="p-4">{c.value}</td>
                  <td className="p-4">{c.active ? 'Activo' : 'Inactivo'}</td>
                  <td className="p-4">
                    <button
                      onClick={() => handleDelete(c.id)}
                      className="p-1.5 bg-red-600 text-white rounded hover:bg-red-500"
                      title="Eliminar"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr><td className="p-4" colSpan={5}>No hay cupones creados.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
