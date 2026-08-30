'use client'

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Edit3,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  Plus,
  Save,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Upload,
  X,
} from 'lucide-react'

import {
  deleteAdminQuickLink,
  getAdminQuickLinks,
  saveAdminQuickLink,
  setAdminQuickLinkActive,
  type HomeQuickLink,
} from '@/app/actions/admin-quick-links'
import { createUploadTicketAction } from '@/app/actions/storage-uploads'
import { QuickLinkIcon } from '@/components/home/QuickLinkIcon'
import { QUICK_LINK_ICON_OPTIONS, type QuickLinkIconKey } from '@/lib/home/quick-links'
import { createClient } from '@/lib/supabase/client'
import { uploadWithTicket } from '@/lib/storage/upload-client'

type FormState = {
  label: string
  url: string
  imageUrl: string
  iconKey: QuickLinkIconKey
  displayOrder: number
  active: boolean
}

const EMPTY_FORM: FormState = {
  label: '',
  url: '/catalog',
  imageUrl: '',
  iconKey: 'sparkles',
  displayOrder: 0,
  active: true,
}

function formFromRecord(record: HomeQuickLink): FormState {
  return {
    label: record.label,
    url: record.url,
    imageUrl: record.image_url || '',
    iconKey: record.icon_key,
    displayOrder: record.display_order,
    active: record.active,
  }
}

export default function AdminQuickLinksPage() {
  const supabase = useMemo(() => createClient(), [])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [quickLinks, setQuickLinks] = useState<HomeQuickLink[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [file, setFile] = useState<File | null>(null)
  const [filePreviewUrl, setFilePreviewUrl] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const loadQuickLinks = useCallback(async () => {
    setLoading(true)
    const result = await getAdminQuickLinks()
    if (result.success) {
      setQuickLinks(result.data)
      setError('')
    } else {
      setError(result.error)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void loadQuickLinks()
  }, [loadQuickLinks])

  useEffect(() => {
    if (!file) {
      setFilePreviewUrl('')
      return
    }
    const objectUrl = URL.createObjectURL(file)
    setFilePreviewUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file])

  const resetFeedback = () => {
    setMessage('')
    setError('')
  }

  const openNew = () => {
    resetFeedback()
    setEditingId(null)
    setForm({ ...EMPTY_FORM, displayOrder: quickLinks.length })
    setFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    setFormOpen(true)
  }

  const openEdit = (quickLink: HomeQuickLink) => {
    resetFeedback()
    setEditingId(quickLink.id)
    setForm(formFromRecord(quickLink))
    setFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    setFormOpen(true)
  }

  const closeForm = () => {
    setFormOpen(false)
    setEditingId(null)
    setFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    resetFeedback()
    setSaving(true)

    try {
      let imageUrl = form.imageUrl
      if (file) {
        const ticket = await createUploadTicketAction({
          kind: 'banner',
          name: file.name,
          size: file.size,
          mimeType: file.type,
        })
        await uploadWithTicket(file, ticket)
        imageUrl = supabase.storage.from(ticket.bucket).getPublicUrl(ticket.path).data.publicUrl
      }

      const result = await saveAdminQuickLink({ ...form, imageUrl }, editingId)
      if (!result.success) {
        setError(result.error)
        return
      }

      setMessage(editingId ? 'Acceso rápido actualizado.' : 'Acceso rápido creado.')
      closeForm()
      await loadQuickLinks()
    } catch {
      setError('No se pudo guardar el acceso rápido. Revisa la imagen e intenta nuevamente.')
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (quickLink: HomeQuickLink) => {
    resetFeedback()
    setBusyId(quickLink.id)
    const result = await setAdminQuickLinkActive(quickLink.id, !quickLink.active)
    if (result.success) {
      setMessage(result.data.active ? 'Acceso rápido activado.' : 'Acceso rápido desactivado.')
      await loadQuickLinks()
    } else {
      setError(result.error)
    }
    setBusyId(null)
  }

  const remove = async (quickLink: HomeQuickLink) => {
    if (!window.confirm(`¿Eliminar “${quickLink.label}”? Esta acción no elimina archivos de imágenes.`)) return
    resetFeedback()
    setBusyId(quickLink.id)
    const result = await deleteAdminQuickLink(quickLink.id)
    if (result.success) {
      setMessage('Acceso rápido eliminado.')
      await loadQuickLinks()
    } else {
      setError(result.error)
    }
    setBusyId(null)
  }

  const previewUrl = filePreviewUrl || form.imageUrl

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#9D1B1B]">Contenido de portada</p>
          <h1 className="mt-1 text-2xl font-extrabold text-slate-900 sm:text-3xl">Accesos rápidos de Home</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Crea, ordena y activa los accesos que aparecen debajo del banner principal.
          </p>
        </div>
        {!formOpen && (
          <button
            type="button"
            onClick={openNew}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#0F172A] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-slate-800"
          >
            <Plus size={18} aria-hidden="true" /> Nuevo acceso
          </button>
        )}
      </div>

      <div aria-live="polite" className="min-h-6">
        {message && <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{message}</p>}
        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">{error}</p>}
      </div>

      {formOpen && (
        <form onSubmit={save} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <h2 className="text-lg font-bold text-slate-900">{editingId ? 'Editar acceso' : 'Nuevo acceso'}</h2>
            <button type="button" onClick={closeForm} aria-label="Cerrar formulario" className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100">
              <X size={20} aria-hidden="true" />
            </button>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
            <div className="grid min-w-0 gap-5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label htmlFor="quick-link-label" className="mb-1.5 block text-sm font-bold text-slate-700">Etiqueta</label>
                <input id="quick-link-label" required maxLength={80} value={form.label} onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))} className="min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-[#9D1B1B] focus:ring-2 focus:ring-[#9D1B1B]/20" placeholder="Ej. Ver catálogo Magic" />
              </div>

              <div className="sm:col-span-2">
                <label htmlFor="quick-link-url" className="mb-1.5 block text-sm font-bold text-slate-700">URL de destino</label>
                <input id="quick-link-url" required maxLength={500} value={form.url} onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))} className="min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-[#9D1B1B] focus:ring-2 focus:ring-[#9D1B1B]/20" placeholder="/catalog o https://..." />
                <p className="mt-1 text-xs text-slate-500">Usa una ruta interna que empiece con / o una URL HTTPS.</p>
              </div>

              <div>
                <label htmlFor="quick-link-icon" className="mb-1.5 block text-sm font-bold text-slate-700">Icono alternativo</label>
                <select id="quick-link-icon" value={form.iconKey} onChange={(event) => setForm((current) => ({ ...current, iconKey: event.target.value as QuickLinkIconKey }))} className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-[#9D1B1B] focus:ring-2 focus:ring-[#9D1B1B]/20">
                  {QUICK_LINK_ICON_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </div>

              <div>
                <label htmlFor="quick-link-order" className="mb-1.5 block text-sm font-bold text-slate-700">Orden</label>
                <input id="quick-link-order" type="number" min={0} max={9999} step={1} required value={form.displayOrder} onChange={(event) => setForm((current) => ({ ...current, displayOrder: Number(event.target.value) }))} className="min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-[#9D1B1B] focus:ring-2 focus:ring-[#9D1B1B]/20" />
              </div>

              <label className="flex min-h-11 items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 sm:col-span-2">
                <input type="checkbox" checked={form.active} onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))} className="h-4 w-4 accent-[#9D1B1B]" />
                <span className="text-sm font-bold text-slate-700">Mostrar este acceso en Home</span>
              </label>
            </div>

            <div className="min-w-0 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="quick-link-image" className="text-sm font-bold text-slate-700">Imagen opcional</label>
                {(form.imageUrl || file) && (
                  <button type="button" onClick={() => { setFile(null); setForm((current) => ({ ...current, imageUrl: '' })); if (fileInputRef.current) fileInputRef.current.value = '' }} className="text-xs font-bold text-red-700 hover:underline">Quitar imagen</button>
                )}
              </div>
              <label htmlFor="quick-link-image" className="group relative flex aspect-[16/7] cursor-pointer items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 transition-colors hover:border-[#9D1B1B]">
                {previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={previewUrl} alt="Previsualización del acceso" className="absolute inset-0 h-full w-full object-cover" />
                ) : (
                  <span className="flex flex-col items-center gap-2 px-4 text-center text-sm text-slate-500"><ImageIcon size={34} aria-hidden="true" />Sin imagen: se mostrará el icono</span>
                )}
                <span className="absolute inset-0 flex items-center justify-center bg-slate-950/60 text-sm font-bold text-white opacity-0 transition-opacity group-hover:opacity-100"><Upload size={17} className="mr-2" aria-hidden="true" />Seleccionar imagen</span>
              </label>
              <input ref={fileInputRef} id="quick-link-image" type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => setFile(event.target.files?.[0] || null)} />
              <p className="text-xs text-slate-500">JPG, PNG o WebP, máximo 5 MB. Si no hay imagen se usa el icono seleccionado.</p>

              {!previewUrl && (
                <div className="flex min-h-20 items-center gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#9D1B1B]/10 text-[#9D1B1B]"><QuickLinkIcon iconKey={form.iconKey} size={22} /></span>
                  <span className="font-bold text-slate-800">{form.label || 'Previsualización'}</span>
                </div>
              )}
            </div>
          </div>

          <div className="mt-6 flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:justify-end">
            <button type="button" onClick={closeForm} className="min-h-11 rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">Cancelar</button>
            <button type="submit" disabled={saving} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#9D1B1B] px-5 py-2 text-sm font-bold text-white hover:bg-[#7E1515] disabled:cursor-not-allowed disabled:opacity-60">
              {saving ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <Save size={18} aria-hidden="true" />}
              {saving ? 'Guardando…' : 'Guardar acceso'}
            </button>
          </div>
        </form>
      )}

      {!formOpen && (
        <section aria-label="Accesos configurados" className="space-y-3">
          {loading && <div className="flex min-h-32 items-center justify-center rounded-xl border border-slate-200 bg-white text-sm text-slate-500"><Loader2 size={20} className="mr-2 animate-spin" aria-hidden="true" />Cargando accesos…</div>}
          {!loading && quickLinks.length === 0 && (
            <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-white p-6 text-center text-slate-500">
              <ImageIcon size={40} className="mb-3 text-slate-300" aria-hidden="true" />
              <p className="font-bold text-slate-700">No hay accesos configurados.</p>
              <p className="mt-1 text-sm">La portada no cambia hasta que crees el primero.</p>
            </div>
          )}
          {quickLinks.map((quickLink) => (
            <article key={quickLink.id} className={`rounded-xl border bg-white p-4 shadow-sm ${quickLink.active ? 'border-slate-200' : 'border-slate-200 opacity-65'}`}>
              <div className="flex flex-col gap-4 md:flex-row md:items-center">
                <div className="relative flex h-24 w-full shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 md:w-44">
                  {quickLink.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={quickLink.image_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
                  ) : (
                    <span className="text-[#9D1B1B]"><QuickLinkIcon iconKey={quickLink.icon_key} size={30} /></span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-bold text-slate-600">Orden {quickLink.display_order}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${quickLink.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{quickLink.active ? 'Activo' : 'Inactivo'}</span>
                  </div>
                  <h2 className="mt-2 truncate text-lg font-extrabold text-slate-900">{quickLink.label}</h2>
                  <a href={quickLink.url} target={quickLink.url.startsWith('http') ? '_blank' : undefined} rel={quickLink.url.startsWith('http') ? 'noreferrer' : undefined} className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-sm font-medium text-[#7E1515] hover:underline">
                    <span className="truncate">{quickLink.url}</span><ExternalLink size={14} className="shrink-0" aria-hidden="true" />
                  </a>
                </div>
                <div className="grid grid-cols-3 gap-2 md:flex md:shrink-0">
                  <button type="button" disabled={busyId === quickLink.id} onClick={() => void toggleActive(quickLink)} aria-label={`${quickLink.active ? 'Desactivar' : 'Activar'} ${quickLink.label}`} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-200 px-3 text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                    {quickLink.active ? <ToggleRight size={25} className="text-emerald-600" aria-hidden="true" /> : <ToggleLeft size={25} aria-hidden="true" />}
                  </button>
                  <button type="button" onClick={() => openEdit(quickLink)} aria-label={`Editar ${quickLink.label}`} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 px-3 text-blue-700 hover:bg-blue-100"><Edit3 size={18} aria-hidden="true" /></button>
                  <button type="button" disabled={busyId === quickLink.id} onClick={() => void remove(quickLink)} aria-label={`Eliminar ${quickLink.label}`} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-red-200 bg-red-50 px-3 text-red-700 hover:bg-red-100 disabled:opacity-50"><Trash2 size={18} aria-hidden="true" /></button>
                </div>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  )
}
