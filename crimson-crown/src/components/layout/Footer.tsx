"use client"
import Link from 'next/link'
import { Instagram, MessageCircle, Mail, MapPin } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { siteConfig } from '@/config/site'

export default function Footer() {
  const supabase = createClient()
  const [info, setInfo] = useState({
    contact_whatsapp: siteConfig.socialLinks.whatsapp,
    contact_instagram: siteConfig.socialLinks.instagram,
    contact_email: siteConfig.socialLinks.email,
    contact_address: 'Almagro, Ciudad Autónoma de Buenos Aires.',
    contact_address_note: '(Dirección exacta al coordinar retiro)',
    contact_schedule: 'Lunes a Viernes de 10 a 19hs',
    store_description: siteConfig.description
  })

  useEffect(() => {
    const cleanValue = (val: any) => {
      if (typeof val === 'string' && val.startsWith('"') && val.endsWith('"')) {
        try { return JSON.parse(val) } catch { return val.slice(1, -1) }
      }
      return val
    }
    const load = async () => {
      const { data } = await supabase.from('system_settings').select('*')
      if (data && Array.isArray(data)) {
        const next: any = { ...info }
        for (const row of data) {
          const v = cleanValue(row.value)
          if (Object.prototype.hasOwnProperty.call(next, row.key)) next[row.key] = v
        }
        setInfo(next)
      }
    }
    load()
  }, [])
  return (
    <footer className="bg-[#0F172A] text-slate-300 py-12 border-t border-slate-800 mt-auto">
      <div className="mx-auto max-w-7xl px-4 grid grid-cols-1 md:grid-cols-3 gap-8">
        <div>
          <h3 className="text-white font-extrabold text-xl mb-4 tracking-tight">{siteConfig.name.toUpperCase()}</h3>
          <p className="text-sm leading-relaxed mb-4 text-slate-400">{info.store_description}</p>
          <div className="flex gap-4">
            <a href={info.contact_instagram} target="_blank" rel="noopener noreferrer" className="hover:text-[#E91E63] transition-colors"><Instagram size={24} /></a>
            <a href={`https://wa.me/${info.contact_whatsapp}`} target="_blank" rel="noopener noreferrer" className="hover:text-green-500 transition-colors"><MessageCircle size={24} /></a>
            <a href={`mailto:${info.contact_email}`} className="hover:text-blue-400 transition-colors"><Mail size={24} /></a>
          </div>
        </div>
        <div>
          <h4 className="text-white font-bold mb-4 uppercase text-sm tracking-wider">Navegación</h4>
          <ul className="space-y-2 text-sm">
            {/* BUG FIX: Link corregido a /catalog */}
            <li><Link href="/catalog" className="hover:text-white transition-colors">Catálogo Completo</Link></li>
            <li><Link href="/buylist" className="hover:text-white transition-colors">Vender Cartas (Buylist)</Link></li>
            <li><Link href="/faq" className="hover:text-white transition-colors">Preguntas Frecuentes</Link></li>
            <li><Link href="/profile" className="hover:text-white transition-colors">Mi Cuenta</Link></li>
          </ul>
        </div>
        <div>
          <h4 className="text-white font-bold mb-4 uppercase text-sm tracking-wider">Contacto</h4>
          <ul className="space-y-3 text-sm">
            <li className="flex items-start gap-3">
              <MapPin size={18} className="text-[#E91E63] shrink-0 mt-0.5" />
              <span>{info.contact_address}<br/><span className="text-xs text-slate-500">{info.contact_address_note}</span></span>
            </li>
            <li className="flex items-start gap-3">
              <MessageCircle size={18} className="text-green-500 shrink-0 mt-0.5" />
              <span>WhatsApp: +{info.contact_whatsapp}<br/><span className="text-xs text-slate-500">{info.contact_schedule}</span></span>
            </li>
          </ul>
        </div>
      </div>
      <div className="mx-auto max-w-7xl px-4 mt-12 pt-8 border-t border-slate-800 text-center text-xs text-slate-500">
        &copy; {new Date().getFullYear()} {siteConfig.name}. Todos los derechos reservados.
      </div>
    </footer>
  )
}
