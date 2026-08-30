"use client"
import { Suspense } from 'react'
import AdminNav from '@/components/admin/AdminNav'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <AdminNav />
      <div className="container mx-auto py-8">
        <Suspense fallback={<div className="p-8 text-center text-slate-500">Cargando panel...</div>}>
          {children}
        </Suspense>
      </div>
    </div>
  )
}

