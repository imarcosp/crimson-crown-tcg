"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Search, UserRoundPlus } from "lucide-react"
import {
  createAdminManualBuylistDraft,
  searchAdminManualBuylistUsers,
} from "@/app/actions/admin-buylists"

export default function NewAdminBuylistPage() {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [searching, setSearching] = useState(false)
  const [creatingFor, setCreatingFor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [users, setUsers] = useState<any[]>([])

  const canSearch = useMemo(() => query.trim().length >= 2, [query])

  const handleSearch = async () => {
    if (!canSearch) {
      setUsers([])
      setError(null)
      return
    }

    setSearching(true)
    setError(null)
    const result = await searchAdminManualBuylistUsers(query)
    setSearching(false)

    if (!result?.success) {
      setUsers([])
      setError(result?.error || "No se pudo buscar usuarios.")
      return
    }

    setUsers(result.users || [])
  }

  const handleCreateDraft = async (userId: string) => {
    setCreatingFor(userId)
    setError(null)
    const result = await createAdminManualBuylistDraft(userId)
    setCreatingFor(null)

    if (!result?.success || !result.orderId) {
      setError(result?.error || "No se pudo crear el borrador.")
      return
    }

    router.push(`/admin/buylists/${result.orderId}`)
  }

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5">
          <h1 className="text-2xl font-bold text-slate-900">Nueva cotización manual</h1>
          <p className="mt-1 text-sm text-slate-600">
            Busca un usuario existente por nombre, apellido o email para crearle un borrador de cotización manual.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  handleSearch()
                }
              }}
              placeholder="Ej: Marcos, Perchez o email@ejemplo.com"
              className="w-full rounded-xl border border-slate-300 py-3 pl-10 pr-4 text-sm outline-none transition focus:border-[#9D1B1B] focus:ring-2 focus:ring-[#9D1B1B]/10"
            />
          </div>
          <button
            type="button"
            onClick={handleSearch}
            disabled={!canSearch || searching}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#0F172A] px-5 py-3 text-sm font-bold text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
          >
            {searching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
            Buscar usuario
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {error}
          </div>
        )}

        <div className="mt-6 space-y-3">
          {users.map((user) => {
            const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ") || "Sin nombre"
            const isCreating = creatingFor === user.id

            return (
              <div
                key={user.id}
                className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold text-slate-900">{fullName}</div>
                  <div className="truncate text-xs text-slate-500">{user.email || "Sin email"}</div>
                </div>
                <button
                  type="button"
                  onClick={() => handleCreateDraft(user.id)}
                  disabled={isCreating}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-purple-200 bg-purple-50 px-4 py-2 text-sm font-bold text-purple-700 transition hover:bg-purple-100 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
                >
                  {isCreating ? <Loader2 size={16} className="animate-spin" /> : <UserRoundPlus size={16} />}
                  Crear borrador
                </button>
              </div>
            )
          })}

          {!searching && canSearch && users.length === 0 && !error && (
            <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">
              No encontramos usuarios con ese criterio.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
