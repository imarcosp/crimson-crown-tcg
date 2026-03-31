"use client"
import Link from 'next/link'
import { Package, Plane, Banknote, Users, Settings, ClipboardList, TrendingUp, Calendar, DollarSign, Search, Bell } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function AdminPage() {
  const [stats, setStats] = useState({ week: 0, month: 0, year: 0 })
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    const fetchStats = async () => {
      const now = new Date()
      const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).toISOString()
      
      const { data: orders } = await supabase
        .from('orders')
        .select('total_amount, created_at')
        .gte('created_at', oneYearAgo)
        .in('status', ['paid', 'shipped', 'completed'])

      if (orders) {
        const oneWeekAgoTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).getTime()
        const oneMonthAgoTime = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()).getTime()

        const newStats = orders.reduce((acc, order) => {
          const orderTime = new Date(order.created_at).getTime()
          const amount = Number(order.total_amount || 0)

          acc.year += amount
          if (orderTime >= oneMonthAgoTime) acc.month += amount
          if (orderTime >= oneWeekAgoTime) acc.week += amount
          return acc
        }, { week: 0, month: 0, year: 0 })

        setStats(newStats)
      }
      setLoading(false)
    }
    fetchStats()
  }, [])

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#0F172A]">Panel de Administración</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
            <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-emerald-100 text-emerald-600 rounded-lg"><TrendingUp size={20}/></div>
                <h3 className="font-bold text-slate-500 text-sm uppercase">Ventas Semanales</h3>
            </div>
            <p className="text-3xl font-extrabold text-slate-900">
                {loading ? '...' : `US$ ${stats.week.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
            </p>
            <p className="text-xs text-slate-400 mt-2">Últimos 7 días</p>
        </div>
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
            <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-blue-100 text-blue-600 rounded-lg"><Calendar size={20}/></div>
                <h3 className="font-bold text-slate-500 text-sm uppercase">Ventas Mensuales</h3>
            </div>
            <p className="text-3xl font-extrabold text-slate-900">
                {loading ? '...' : `US$ ${stats.month.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
            </p>
            <p className="text-xs text-slate-400 mt-2">Últimos 30 días</p>
        </div>
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
            <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-purple-100 text-purple-600 rounded-lg"><DollarSign size={20}/></div>
                <h3 className="font-bold text-slate-500 text-sm uppercase">Ventas Anuales</h3>
            </div>
            <p className="text-3xl font-extrabold text-slate-900">
                {loading ? '...' : `US$ ${stats.year.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
            </p>
            <p className="text-xs text-slate-400 mt-2">Últimos 365 días</p>
        </div>
      </div>

      <h2 className="text-xl font-bold text-slate-800 pt-4">Accesos Rápidos</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        <Link href="/admin/inventory" className="group rounded-xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-lg transition-shadow">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-lg bg-blue-50 text-blue-600"><Package size={32} /></div>
            <div>
              <div className="text-lg font-bold text-slate-900">Inventario</div>
              <p className="text-sm text-slate-600">Gestiona stock, variantes y cargas CSV.</p>
            </div>
          </div>
        </Link>
        <Link href="/admin/imports" className="group rounded-xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-lg transition-shadow">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-lg bg-sky-50 text-sky-600"><Plane size={32} /></div>
            <div>
              <div className="text-lg font-bold text-slate-900">Órdenes de Importación</div>
              <p className="text-sm text-slate-600">Gestiona pedidos al exterior y su estado.</p>
            </div>
          </div>
        </Link>
        <Link href="/admin/orders" className="group rounded-xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-lg transition-shadow">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-lg bg-emerald-50 text-emerald-600"><Banknote size={32} /></div>
            <div>
              <div className="text-lg font-bold text-slate-900">Ventas de Stock</div>
              <p className="text-sm text-slate-600">Administra órdenes y actualizaciones.</p>
            </div>
          </div>
        </Link>
        <Link href="/admin/buylists" className="group rounded-xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-lg transition-shadow">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-lg bg-orange-50 text-orange-600"><ClipboardList size={32} /></div>
            <div>
              <div className="text-lg font-bold text-slate-900">Solicitudes de Compra</div>
              <p className="text-sm text-slate-600">Revisar cartas que los usuarios quieren vender.</p>
            </div>
          </div>
        </Link>
        
        {/* NUEVO: ALERTAS DE STOCK / WISHLIST */}
        <Link href="/admin/wishlists" className="group rounded-xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-lg transition-shadow">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-lg bg-yellow-50 text-yellow-600"><Bell size={32} /></div>
            <div>
              <div className="text-lg font-bold text-slate-900">Alertas de Stock</div>
              <p className="text-sm text-slate-600">Ver qué están esperando comprar tus clientes.</p>
            </div>
          </div>
        </Link>

        <Link href="/admin/searches" className="group rounded-xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-lg transition-shadow">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-lg bg-pink-50 text-pink-600"><Search size={32} /></div>
            <div>
              <div className="text-lg font-bold text-slate-900">Demanda / Búsquedas</div>
              <p className="text-sm text-slate-600">Analiza qué cartas buscan tus usuarios.</p>
            </div>
          </div>
        </Link>

        <Link href="/admin/users" className="group rounded-xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-lg transition-shadow">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-lg bg-purple-50 text-purple-600"><Users size={32} /></div>
            <div>
              <div className="text-lg font-bold text-slate-900">Usuarios</div>
              <p className="text-sm text-slate-600">Listados y gestión de perfiles.</p>
            </div>
          </div>
        </Link>
        <Link href="/admin/prices" className="group rounded-xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-lg transition-shadow">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-lg bg-slate-100 text-slate-700"><Settings size={32} /></div>
            <div>
              <div className="text-lg font-bold text-slate-900">Configuración / Precios</div>
              <p className="text-sm text-slate-600">Ajustes globales y sincronización.</p>
            </div>
          </div>
        </Link>
      </div>
    </div>
  )
}