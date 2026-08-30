"use client"

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Menu, X } from 'lucide-react'

import { createClient } from '@/lib/supabase/client'

const adminLinks = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/inventories', label: 'Inventarios' },
  { href: '/admin/commissions', label: 'Comisiones' },
] as const

export default function AdminNav() {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [mobileOpen, setMobileOpen] = useState(false)

  const isActive = (href: string) => (
    href === '/admin' || href === '/' ? pathname === href : pathname.startsWith(href)
  )

  const linkClass = (href: string, mobile = false) => {
    const dimensions = mobile
      ? 'flex min-h-11 w-full items-center rounded-lg px-3 py-2.5 text-sm'
      : 'rounded-md px-3 py-2 text-sm'
    return `${dimensions} transition-colors active:scale-[0.98] ${
      isActive(href)
        ? 'bg-slate-100 font-bold text-[#0F172A]'
        : 'text-slate-700 hover:bg-slate-50'
    }`
  }

  const logout = async () => {
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }

  const currentSection = [...adminLinks]
    .reverse()
    .find(({ href }) => isActive(href))?.label ?? 'Administración'

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="container mx-auto px-4">
        <div className="flex min-h-14 items-center justify-between gap-3 md:hidden">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#9D1B1B]">Panel administrativo</p>
            <p className="truncate text-sm font-bold text-slate-900">{currentSection}</p>
          </div>
          <button
            type="button"
            aria-label="Abrir navegación administrativa"
            aria-controls="admin-mobile-navigation"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((open) => !open)}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-700 transition-colors hover:bg-slate-50 active:scale-[0.97]"
          >
            {mobileOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>
        </div>

        <nav
          id="admin-mobile-navigation"
          aria-label="Navegación administrativa móvil"
          hidden={!mobileOpen}
          className="border-t border-slate-100 py-3 md:hidden"
        >
          <div className="grid gap-1">
            {adminLinks.map(({ href, label }) => (
              <Link key={href} href={href} className={linkClass(href, true)} onClick={() => setMobileOpen(false)}>
                {label}
              </Link>
            ))}
            <Link href="/" className={linkClass('/', true)} onClick={() => setMobileOpen(false)}>Ir a la Web</Link>
            <button
              type="button"
              onClick={logout}
              className="mt-1 flex min-h-11 w-full items-center rounded-lg bg-[#0F172A] px-3 py-2.5 text-left text-sm font-bold text-white transition-colors hover:bg-slate-800 active:scale-[0.98]"
            >
              Cerrar Sesión
            </button>
          </div>
        </nav>

        <nav aria-label="Navegación administrativa" className="hidden min-h-16 items-center gap-2 md:flex">
          {adminLinks.map(({ href, label }) => (
            <Link key={href} href={href} className={linkClass(href)}>{label}</Link>
          ))}
          <div className="flex-1" />
          <Link href="/" className="rounded-md px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50 active:scale-[0.98]">Ir a la Web</Link>
          <button
            type="button"
            onClick={logout}
            className="cursor-pointer rounded-md bg-[#0F172A] px-3 py-2 text-sm font-bold text-white transition-colors hover:bg-slate-800 active:scale-[0.97]"
          >
            Cerrar Sesión
          </button>
        </nav>
      </div>
    </header>
  )
}
