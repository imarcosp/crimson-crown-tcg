"use client"
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function AdminNav() {
  const pathname = usePathname()
  const supabase = createClient()
  const linkClass = (href: string) => (
    (href === '/admin' ? pathname === href : pathname.startsWith(href))
      ? 'px-3 py-2 rounded-md text-sm font-bold text-[#0F172A] bg-slate-100'
      : 'px-3 py-2 rounded-md text-sm text-slate-700 hover:bg-slate-50'
  )
  const logout = async () => {
    await supabase.auth.signOut()
    window.location.href = '/'
  }
  return (
    <nav className="bg-white border-b border-slate-200">
      <div className="container mx-auto px-4 py-3 flex items-center gap-2 flex-wrap">
        <Link href="/admin" className={linkClass('/admin')}>Dashboard</Link>
        <Link href="/admin/inventories" className={linkClass('/admin/inventories')}>Inventarios</Link>
        <Link href="/admin/commissions" className={linkClass('/admin/commissions')}>Comisiones</Link>
        <div className="flex-1" />
        <Link href="/" className="px-3 py-2 rounded-md text-sm text-slate-700 hover:bg-slate-50">Ir a la Web</Link>
        <button onClick={logout} className="px-3 py-2 rounded-md text-sm text-white bg-[#0F172A] hover:bg-slate-800 font-bold cursor-pointer">Cerrar Sesión</button>
      </div>
    </nav>
  )
}
