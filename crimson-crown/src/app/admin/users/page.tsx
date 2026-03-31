"use client"
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Search, Edit, Lock, Loader2, ShieldCheck, Banknote } from 'lucide-react'
import Link from 'next/link'

export default function AdminUsersPage() {
  const supabase = createClient()
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [editingUser, setEditingUser] = useState<any | null>(null)
  const [formData, setFormData] = useState({ first_name: '', last_name: '', phone: '' })
  const [saving, setSaving] = useState(false)

  // Carga inicial
  useEffect(() => {
    const fetchUsers = async () => {
      setLoading(true)
      // Ordenamos por email (columna segura en auth/profiles)
      let q = supabase
        .from('profiles')
        .select('id, email, first_name, last_name, phone, credits')
        .order('email', { ascending: true })
        .limit(50)

      if (query.length > 2) {
        q = q.ilike('email', `%${query}%`)
      }

      const { data, error } = await q
      if (!error) setUsers(data || [])
      setLoading(false)
    }

    const timer = setTimeout(fetchUsers, 500)
    return () => clearTimeout(timer)
  }, [query])

  const handleEdit = (u: any) => {
    setEditingUser(u)
    setFormData({
      first_name: u.first_name || '',
      last_name: u.last_name || '',
      phone: u.phone || ''
    })
  }

  const handleSave = async () => {
    if (!editingUser) return
    setSaving(true)
    const { error } = await supabase
      .from('profiles')
      .update(formData)
      .eq('id', editingUser.id)
    
    if (error) alert('Error: ' + error.message)
    else {
      alert('Usuario actualizado')
      setUsers(users.map(u => u.id === editingUser.id ? { ...u, ...formData } : u))
      setEditingUser(null)
    }
    setSaving(false)
  }

  const sendPasswordReset = async (email: string) => {
    if (!confirm(`¿Enviar correo de recuperación a ${email}?`)) return
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/update-password`,
    })
    if (error) alert('Error: ' + error.message)
    else alert('Correo enviado.')
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* HEADER CON BOTÓN DE CRÉDITOS */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <h1 className="text-xl md:text-2xl font-bold text-slate-800 flex items-center gap-2">
           <ShieldCheck className="text-purple-600"/> Gestión de Usuarios
        </h1>
        <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
           {/* BOTÓN NUEVO SOLICITADO */}
           <Link href="/admin/credits" className="w-full sm:w-auto justify-center px-4 py-2 bg-emerald-600 text-white rounded-lg font-bold text-sm flex items-center gap-2 hover:bg-emerald-700 transition-colors shadow-sm">
              <Banknote size={16}/> Gestionar Créditos
           </Link>

           <div className="relative w-full sm:w-64">
             <Search className="absolute left-3 top-2.5 text-slate-400" size={18}/>
             <input 
               value={query} onChange={(e) => setQuery(e.target.value)}
               placeholder="Buscar email..." 
               className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-purple-600"
             />
           </div>
        </div>
      </div>

      {/* FIX: overflow-x-auto para que la tabla scrollee en móvil */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden overflow-x-auto">
        <table className="w-full text-sm text-left whitespace-nowrap">
          <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-xs">
            <tr>
              <th className="p-4">Usuario</th>
              <th className="p-4">Nombre</th>
              <th className="p-4">Teléfono</th>
              <th className="p-4">Créditos</th>
              <th className="p-4 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={5} className="p-8 text-center"><Loader2 className="animate-spin inline text-purple-600"/></td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={5} className="p-8 text-center text-slate-500">No se encontraron usuarios.</td></tr>
            ) : (
              users.map(u => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="p-4 font-bold text-slate-800">{u.email}</td>
                  <td className="p-4 text-slate-600">{u.first_name} {u.last_name}</td>
                  <td className="p-4 text-slate-500">{u.phone || '-'}</td>
                  <td className="p-4 font-mono font-bold text-emerald-600">${Number(u.credits || 0).toFixed(2)}</td>
                  <td className="p-4 flex justify-end gap-2">
                    <button onClick={() => sendPasswordReset(u.email)} className="p-2 text-slate-400 hover:text-orange-600 hover:bg-orange-50 rounded" title="Reset Password"><Lock size={16}/></button>
                    <button onClick={() => handleEdit(u)} className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded" title="Editar"><Edit size={16}/></button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md">
            <h3 className="text-lg font-bold mb-4">Editar Usuario</h3>
            <div className="space-y-3">
              <div>
                 <label className="text-xs font-bold text-slate-500 uppercase">Nombre</label>
                 <input value={formData.first_name} onChange={e => setFormData({...formData, first_name: e.target.value})} className="w-full border p-2 rounded"/>
              </div>
              <div>
                 <label className="text-xs font-bold text-slate-500 uppercase">Apellido</label>
                 <input value={formData.last_name} onChange={e => setFormData({...formData, last_name: e.target.value})} className="w-full border p-2 rounded"/>
              </div>
              <div>
                 <label className="text-xs font-bold text-slate-500 uppercase">Teléfono</label>
                 <input value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} className="w-full border p-2 rounded"/>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setEditingUser(null)} className="px-4 py-2 text-slate-600 font-bold hover:bg-slate-100 rounded">Cancelar</button>
              <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-slate-900 text-white font-bold rounded hover:bg-slate-800">Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}