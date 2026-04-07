"use client"
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Trash2, Edit, Plus, Image as ImageIcon, ToggleLeft, ToggleRight, Save, X, Upload, Link as LinkIcon, ExternalLink } from 'lucide-react'

export default function AdminBannersPage() {
  const supabase = createClient()
  const [banners, setBanners] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<any | null>(null)
  const [uploading, setUploading] = useState(false)

  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [btnText, setBtnText] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [order, setOrder] = useState(0)
  const [file, setFile] = useState<File | null>(null)
  const [currentImageUrl, setCurrentImageUrl] = useState('')

  const fetchBanners = async () => {
    setLoading(true)
    const { data } = await supabase.from('banners').select('*').order('display_order', { ascending: true })
    setBanners(data || [])
    setLoading(false)
  }

  useEffect(() => { fetchBanners() }, [])

  const handleEdit = (b: any) => {
    setEditing(b)
    setTitle(b.title || '')
    setDesc(b.description || '')
    setBtnText(b.button_text || 'Ver más')
    setLinkUrl(b.link_url || '#')
    setOrder(b.display_order || 0)
    setCurrentImageUrl(b.image_url || '')
    setFile(null)
  }

  const handleNew = () => {
    setEditing({ id: null })
    setTitle('')
    setDesc('')
    setBtnText('Ver Stock')
    setLinkUrl('#stock')
    setOrder(0)
    setCurrentImageUrl('')
    setFile(null)
  }

  const handleSave = async () => {
    try {
      setUploading(true)
      let finalUrl = currentImageUrl

      if (file) {
        const fileExt = file.name.split('.').pop()
        const fileName = `${Date.now()}.${fileExt}`
        const { error: uploadError } = await supabase.storage.from('banners').upload(fileName, file)
        if (uploadError) throw uploadError
        const { data: { publicUrl } } = supabase.storage.from('banners').getPublicUrl(fileName)
        finalUrl = publicUrl
      }

      if (!finalUrl) {
        alert('Debes subir una imagen obligatoriamente.')
        setUploading(false)
        return
      }

      const payload = {
        title,
        description: desc,
        button_text: btnText,
        link_url: linkUrl,
        display_order: order,
        image_url: finalUrl
      }

      if (editing.id) {
        const { error } = await supabase.from('banners').update(payload).eq('id', editing.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('banners').insert(payload)
        if (error) throw error
      }

      alert('Banner guardado correctamente')
      setEditing(null)
      fetchBanners()

    } catch (e: any) {
      alert('Error: ' + e.message)
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('¿Seguro que quieres eliminar este banner?')) return
    const { error } = await supabase.from('banners').delete().eq('id', id)
    if (!error) fetchBanners()
  }

  const toggleActive = async (b: any) => {
    const { error } = await supabase.from('banners').update({ active: !b.active }).eq('id', b.id)
    if (!error) fetchBanners()
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Gestión de Carrusel (Home)</h1>
        {!editing && (
          <button onClick={handleNew} className="px-4 py-2 bg-slate-900 text-white rounded-lg font-bold flex items-center gap-2 hover:bg-slate-800 transition-colors">
            <Plus size={18}/> Nuevo Banner
          </button>
        )}
      </div>

      {editing ? (
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-lg animate-in slide-in-from-bottom-2">
          <div className="flex justify-between items-center mb-6 pb-2 border-b">
            <h2 className="text-lg font-bold text-slate-800">{editing.id ? 'Editar Banner' : 'Nuevo Banner'}</h2>
            <button onClick={() => setEditing(null)}><X className="text-slate-400 hover:text-slate-600" size={24}/></button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Columna Izquierda: Datos */}
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Título Principal</label>
                <input value={title} onChange={e => setTitle(e.target.value)} className="w-full border p-2.5 rounded-lg focus:ring-2 focus:ring-[#9D1B1B] outline-none" placeholder="Ej: Nueva Colección..." />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Descripción / Subtítulo</label>
                <textarea rows={3} value={desc} onChange={e => setDesc(e.target.value)} className="w-full border p-2.5 rounded-lg resize-none focus:ring-2 focus:ring-[#9D1B1B] outline-none" placeholder="Texto descriptivo..." />
              </div>
              
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                <h3 className="text-xs font-bold text-slate-500 uppercase mb-3 flex items-center gap-2"><LinkIcon size={14}/> Configuración del Botón</h3>
                <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">Texto del Botón</label>
                        <input value={btnText} onChange={e => setBtnText(e.target.value)} className="w-full border p-2 rounded focus:ring-1 focus:ring-slate-400 outline-none" placeholder="Ej: Ver Ofertas" />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">Orden de Aparición</label>
                        <input type="number" value={order} onChange={e => setOrder(Number(e.target.value))} className="w-full border p-2 rounded focus:ring-1 focus:ring-slate-400 outline-none" />
                    </div>
                </div>
                <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Enlace de Destino (URL)</label>
                    <input value={linkUrl} onChange={e => setLinkUrl(e.target.value)} className="w-full border p-2 rounded mb-2 focus:ring-1 focus:ring-slate-400 outline-none" placeholder="https://... o #seccion" />
                    
                    <div className="flex flex-wrap gap-2">
                        <span className="text-[10px] uppercase font-bold text-slate-400 self-center mr-1">Atajos:</span>
                        <button type="button" onClick={() => setLinkUrl('#stock')} className="px-2 py-1 text-[10px] font-bold rounded bg-white border hover:bg-slate-100 text-slate-600 transition-colors">Ir a Stock</button>
                        <button type="button" onClick={() => setLinkUrl('#quote')} className="px-2 py-1 text-[10px] font-bold rounded bg-white border hover:bg-slate-100 text-slate-600 transition-colors">Ir a Cotizar</button>
                        <button type="button" onClick={() => setLinkUrl('/catalog')} className="px-2 py-1 text-[10px] font-bold rounded bg-white border hover:bg-slate-100 text-slate-600 transition-colors">/catalog</button>
                    </div>
                </div>
              </div>
            </div>

            {/* Columna Derecha: Imagen */}
            <div className="space-y-4">
              <label className="block text-sm font-bold text-slate-700">Imagen de Fondo</label>
              <div className="relative aspect-video bg-slate-100 rounded-xl overflow-hidden border-2 border-dashed border-slate-300 flex items-center justify-center group hover:border-[#9D1B1B] transition-colors">
                {(file || currentImageUrl) ? (
                  <img src={file ? URL.createObjectURL(file) : currentImageUrl} className="w-full h-full object-cover" alt="Preview" />
                ) : (
                  <div className="text-slate-400 flex flex-col items-center p-4 text-center">
                    <ImageIcon size={48} className="mb-2 opacity-50"/>
                    <span className="text-sm font-medium">Arrastra una imagen o haz clic</span>
                    <span className="text-xs opacity-70 mt-1">1920x600px (Recomendado)</span>
                  </div>
                )}
                
                <label className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center cursor-pointer transition-opacity">
                  <div className="bg-white text-slate-900 px-4 py-2 rounded-full font-bold flex items-center gap-2 shadow-lg transform translate-y-2 group-hover:translate-y-0 transition-transform">
                    <Upload size={16}/> {file || currentImageUrl ? 'Cambiar Imagen' : 'Subir Imagen'}
                  </div>
                  <input type="file" className="hidden" accept="image/*" onChange={e => { if(e.target.files?.[0]) setFile(e.target.files[0]) }} />
                </label>
              </div>
              
              {/* Preview del Botón */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                <p className="text-xs font-bold text-slate-400 uppercase mb-2 text-center">Previsualización del Botón</p>
                <div className="flex justify-center">
                    <button className="px-8 py-3 bg-[#9D1B1B] text-white font-bold rounded-full shadow-lg text-sm pointer-events-none">
                        {btnText || 'Texto del Botón'}
                    </button>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-8 pt-4 border-t">
            <button onClick={() => setEditing(null)} className="px-4 py-2 rounded-lg border border-slate-300 font-bold hover:bg-slate-50 text-slate-600 transition-colors">Cancelar</button>
            <button onClick={handleSave} disabled={uploading} className="px-6 py-2 rounded-lg bg-[#0F172A] text-white font-bold hover:bg-slate-900 disabled:opacity-50 transition-colors shadow-lg">
              {uploading ? 'Guardando...' : 'Guardar Cambios'}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {banners.length === 0 && !loading && (
            <div className="p-12 text-center text-slate-500 bg-white rounded-xl border-2 border-dashed border-slate-300 flex flex-col items-center">
              <ImageIcon className="w-12 h-12 text-slate-300 mb-3"/>
              <p className="font-medium">No hay banners creados.</p>
              <p className="text-sm opacity-70">Se está mostrando el banner por defecto en la Home.</p>
            </div>
          )}
          {banners.map((b) => (
            <div key={b.id} className={`bg-white p-4 rounded-xl border shadow-sm flex flex-col md:flex-row items-center gap-6 group transition-all hover:border-slate-300 ${!b.active && 'opacity-60 grayscale bg-slate-50'}`}>
              <div className="w-full md:w-64 aspect-video bg-slate-100 rounded-lg overflow-hidden relative shrink-0 shadow-inner">
                <img src={b.image_url} alt="" className="absolute inset-0 w-full h-full object-cover" />
                {!b.active && <div className="absolute inset-0 flex items-center justify-center bg-black/10 font-bold text-white text-xs uppercase tracking-widest">Inactivo</div>}
              </div>
              <div className="flex-1 text-center md:text-left min-w-0">
                <div className="flex items-center justify-center md:justify-start gap-2 mb-2">
                  <span className="bg-slate-100 text-slate-600 text-[10px] font-bold px-2 py-0.5 rounded border border-slate-200">Orden: {b.display_order}</span>
                </div>
                <h3 className="font-bold text-lg text-slate-800 truncate">{b.title || 'Sin Título'}</h3>
                <p className="text-sm text-slate-500 line-clamp-1 mb-2">{b.description || 'Sin descripción'}</p>
                <div className="flex items-center gap-2 justify-center md:justify-start">
                    <span className="text-xs bg-red-50 text-pink-700 px-2 py-1 rounded font-mono border border-pink-100 truncate max-w-[200px]">{b.link_url}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => toggleActive(b)} className="p-2 text-slate-400 hover:text-emerald-600 transition-colors" title={b.active ? 'Desactivar' : 'Activar'}>
                  {b.active ? <ToggleRight size={32} className="text-emerald-500"/> : <ToggleLeft size={32}/>}
                </button>
                <div className="h-8 w-px bg-slate-200 mx-1"></div>
                <button onClick={() => handleEdit(b)} className="p-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 border border-blue-100 transition-colors"><Edit size={18}/></button>
                <button onClick={() => handleDelete(b.id)} className="p-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 border border-red-100 transition-colors"><Trash2 size={18}/></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}