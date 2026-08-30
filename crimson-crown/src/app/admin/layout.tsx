"use client"
import { Suspense } from 'react'
import AdminNav from '@/components/admin/AdminNav'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen overflow-x-clip bg-slate-50">
      <AdminNav />
      <div data-admin-content className="container mx-auto min-w-0 px-3 py-5 sm:px-4 sm:py-8">
        <Suspense fallback={<div className="p-8 text-center text-slate-500">Cargando panel...</div>}>
          {children}
        </Suspense>
      </div>
    </div>
  )
}

