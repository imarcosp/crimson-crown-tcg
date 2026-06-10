'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Clock3, ExternalLink, FileText, Landmark, Loader2, Lock, Plane, Receipt, RefreshCw, ShoppingBag, Upload, Wallet } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/context/AuthContext'
import { OWNER_ADMIN_EMAIL, STAFF_ADMIN_EMAIL } from '@/lib/constants'
import { clampCommissionMonthKey, COMMISSION_START_PERIOD_KEY, formatArs, formatCommissionPeriodLabel, formatUsd, getClientPayableCommissionMonthKey, getCurrentCommissionMonthKey, isPastCommissionMonth, shiftCommissionMonthKey } from '@/lib/commissions'
import { confirmCommissionPaymentAction, createCommissionAdjustmentAction, lockCommissionPeriodAction, refreshCommissionPeriodAction, rejectCommissionPaymentAction, reportCommissionPaymentAction } from '@/app/actions/commissions'

type CommissionPeriod = {
  id: string
  period_key: string
  fixed_fee_usd: number
  sales_base_usd: number
  sales_commission_usd: number
  imports_base_usd: number
  imports_commission_usd: number
  total_due_usd: number
  status: 'open' | 'issued' | 'partially_paid' | 'paid'
  locked_at: string | null
  last_refreshed_at: string | null
}

type CommissionAdjustment = {
  id: string
  period_id: string
  direction: 'debit' | 'credit'
  amount_usd: number
  reason: string
  notes: string | null
  created_at: string
}

type CommissionAllocation = {
  id: string
  payment_id: string
  period_id: string
  amount_usd: number
}

type CommissionLine = {
  id: string
  line_type: 'fixed_fee' | 'stock_order' | 'import_order'
  source_id: string | null
  source_label: string
  source_status: string | null
  source_created_at: string | null
  source_eligible_at: string | null
  base_amount_usd: number
  commission_rate: number
  commission_amount_usd: number
  metadata: Record<string, any>
}

type CommissionPayment = {
  id: string
  status: 'reported' | 'confirmed' | 'rejected'
  currency: 'USD' | 'ARS'
  amount: number
  fx_rate_ars: number | null
  amount_usd: number
  payment_method: string
  reference: string | null
  notes: string | null
  proof_url: string | null
  rejection_reason: string | null
  unapplied_usd?: number
  paid_at: string
  created_at: string
}

function getLocalDateTimeInputValue() {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

function periodStatusClasses(status: CommissionPeriod['status']) {
  if (status === 'paid') return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (status === 'partially_paid') return 'bg-amber-50 text-amber-700 border-amber-200'
  if (status === 'issued') return 'bg-sky-50 text-sky-700 border-sky-200'
  return 'bg-slate-100 text-slate-700 border-slate-200'
}

function formatPeriodStatus(status: CommissionPeriod['status']) {
  if (status === 'paid') return 'Pagado'
  if (status === 'partially_paid') return 'Parcialmente pagado'
  if (status === 'issued') return 'Emitido'
  return 'Abierto'
}

function paymentStatusClasses(status: CommissionPayment['status']) {
  if (status === 'confirmed') return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (status === 'rejected') return 'bg-red-50 text-red-700 border-red-200'
  return 'bg-amber-50 text-amber-700 border-amber-200'
}

function formatPaymentStatus(status: CommissionPayment['status']) {
  if (status === 'confirmed') return 'Confirmado'
  if (status === 'rejected') return 'Rechazado'
  return 'Pendiente'
}

export default function AdminCommissionsPage() {
  const supabase = useMemo(() => createClient(), [])
  const { user } = useAuth()
  const currentMonthKey = useMemo(() => getCurrentCommissionMonthKey(), [])
  const payableMonthKey = useMemo(() => getClientPayableCommissionMonthKey(), [currentMonthKey])

  const [selectedMonth, setSelectedMonth] = useState(() => clampCommissionMonthKey(getCurrentCommissionMonthKey()))
  const [period, setPeriod] = useState<CommissionPeriod | null>(null)
  const [periods, setPeriods] = useState<CommissionPeriod[]>([])
  const [lines, setLines] = useState<CommissionLine[]>([])
  const [payments, setPayments] = useState<CommissionPayment[]>([])
  const [adjustments, setAdjustments] = useState<CommissionAdjustment[]>([])
  const [allocations, setAllocations] = useState<CommissionAllocation[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [submittingPayment, setSubmittingPayment] = useState(false)
  const [uploadingProof, setUploadingProof] = useState(false)
  const [submittingAdjustment, setSubmittingAdjustment] = useState(false)
  const [error, setError] = useState('')
  const [proofFile, setProofFile] = useState<File | null>(null)
  const [viewMode, setViewMode] = useState<'perche' | 'epi'>('perche')

  const [paymentForm, setPaymentForm] = useState({
    currency: 'USD' as 'USD' | 'ARS',
    amount: '',
    fxRateArs: '',
    paymentMethod: '',
    reference: '',
    notes: '',
    paidAt: getLocalDateTimeInputValue(),
  })
  const [adjustmentForm, setAdjustmentForm] = useState({
    direction: 'debit' as 'debit' | 'credit',
    amountUsd: '',
    reason: '',
    notes: '',
  })

  const isOwner = user?.email === OWNER_ADMIN_EMAIL
  const isStaff = user?.email === STAFF_ADMIN_EMAIL
  const isPreviewingClientView = isOwner && viewMode === 'epi'
  const showOwnerView = isOwner && !isPreviewingClientView
  const showClientView = isStaff || isPreviewingClientView

  const loadPeriod = useCallback(async (monthKey: string, sync = true) => {
    const normalizedMonthKey = clampCommissionMonthKey(monthKey)

    setLoading(true)
    setError('')

    try {
      if (sync) {
        setSyncing(true)
        const refreshResult = await refreshCommissionPeriodAction(normalizedMonthKey)
        if (!refreshResult.success) {
          throw new Error(refreshResult.error || 'No se pudo recalcular el período.')
        }
      }

      const { data: periodData, error: periodError } = await supabase
        .from('commission_periods')
        .select('*')
        .eq('period_key', normalizedMonthKey)
        .maybeSingle()

      if (periodError) throw periodError

      if (!periodData) {
        setPeriod(null)
        setPeriods([])
        setLines([])
        setPayments([])
        setAdjustments([])
        setAllocations([])
        return
      }

      const [
        { data: periodsData, error: periodsError },
        { data: linesData, error: linesError },
        { data: paymentsData, error: paymentsError },
        { data: adjustmentsData, error: adjustmentsError },
        { data: allocationsData, error: allocationsError },
      ] = await Promise.all([
        supabase
          .from('commission_periods')
          .select('*')
          .gte('period_key', COMMISSION_START_PERIOD_KEY)
          .order('period_key', { ascending: true }),
        supabase
          .from('commission_period_lines')
          .select('*')
          .eq('period_id', periodData.id)
          .order('line_type', { ascending: true })
          .order('source_eligible_at', { ascending: false }),
        supabase
          .from('commission_payments')
          .select('*')
          .eq('period_id', periodData.id)
          .order('paid_at', { ascending: false })
          .order('created_at', { ascending: false }),
        supabase
          .from('commission_adjustments')
          .select('*')
          .order('created_at', { ascending: false }),
        supabase
          .from('commission_payment_allocations')
          .select('*'),
      ])

      if (periodsError) throw periodsError
      if (linesError) throw linesError
      if (paymentsError) throw paymentsError
      if (adjustmentsError) throw adjustmentsError
      if (allocationsError) throw allocationsError

      setPeriod(periodData as CommissionPeriod)
      setPeriods((periodsData || []) as CommissionPeriod[])
      setLines((linesData || []) as CommissionLine[])
      setPayments((paymentsData || []) as CommissionPayment[])
      setAdjustments((adjustmentsData || []) as CommissionAdjustment[])
      setAllocations((allocationsData || []) as CommissionAllocation[])
    } catch (e: any) {
      setError(e.message || 'No se pudo cargar el panel de comisiones.')
      setPeriod(null)
      setPeriods([])
      setLines([])
      setPayments([])
      setAdjustments([])
      setAllocations([])
    } finally {
      setLoading(false)
      setSyncing(false)
    }
  }, [supabase])

  useEffect(() => {
    if (!user?.email) return
    if (![OWNER_ADMIN_EMAIL, STAFF_ADMIN_EMAIL].includes(user.email)) return
    loadPeriod(selectedMonth, true)
  }, [loadPeriod, selectedMonth, user?.email])

  useEffect(() => {
    if (isStaff || isPreviewingClientView) {
      setSelectedMonth(payableMonthKey)
      return
    }

    if (isOwner && viewMode === 'perche') {
      setSelectedMonth(clampCommissionMonthKey(currentMonthKey))
    }
  }, [currentMonthKey, isOwner, isPreviewingClientView, isStaff, payableMonthKey, viewMode])

  const fixedFeeLine = lines.find((line) => line.line_type === 'fixed_fee')
  const salesLines = lines.filter((line) => line.line_type === 'stock_order')
  const importLines = lines.filter((line) => line.line_type === 'import_order')
  const selectedAdjustments = adjustments.filter((adjustment) => adjustment.period_id === period?.id)

  const adjustmentTotalsByPeriod = useMemo(() => {
    return adjustments.reduce((map, adjustment) => {
      const current = map.get(adjustment.period_id) || 0
      const signedAmount = adjustment.direction === 'debit'
        ? Number(adjustment.amount_usd || 0)
        : -Number(adjustment.amount_usd || 0)
      map.set(adjustment.period_id, current + signedAmount)
      return map
    }, new Map<string, number>())
  }, [adjustments])

  const allocationsByPeriod = useMemo(() => {
    return allocations.reduce((map, allocation) => {
      const current = map.get(allocation.period_id) || 0
      map.set(allocation.period_id, current + Number(allocation.amount_usd || 0))
      return map
    }, new Map<string, number>())
  }, [allocations])

  const periodBalances = useMemo(() => {
    return periods.map((periodItem) => {
      const adjustmentsTotal = adjustmentTotalsByPeriod.get(periodItem.id) || 0
      const allocatedTotal = allocationsByPeriod.get(periodItem.id) || 0
      const effectiveDue = Number(periodItem.total_due_usd || 0) + adjustmentsTotal
      const outstandingUsd = effectiveDue - allocatedTotal

      return {
        ...periodItem,
        adjustmentsTotal,
        allocatedTotal,
        effectiveDue,
        outstandingUsd,
      }
    })
  }, [adjustmentTotalsByPeriod, allocationsByPeriod, periods])

  const selectedBalance = periodBalances.find((periodItem) => periodItem.id === period?.id) || null
  const priorBalances = periodBalances.filter((periodItem) => periodItem.period_key < selectedMonth)
  const dueBalancesUpToSelected = periodBalances.filter((periodItem) => periodItem.period_key <= selectedMonth)
  const currentMonthBalance = periodBalances.find((periodItem) => periodItem.period_key === currentMonthKey) || null

  const carryoverUsd = priorBalances.reduce((sum, periodItem) => sum + periodItem.outstandingUsd, 0)
  const dueStatementUsd = dueBalancesUpToSelected.reduce((sum, periodItem) => sum + periodItem.outstandingUsd, 0)
  const currentPreviewOutstandingUsd = currentMonthBalance?.outstandingUsd || 0
  const isCurrentMonthSelected = selectedMonth === currentMonthKey
  const clientPaymentDisabled = showClientView && isCurrentMonthSelected
  const effectiveTotalDueUsd = selectedBalance?.effectiveDue || Number(period?.total_due_usd || 0)
  const dueNowUsd = Math.max(dueStatementUsd - (isCurrentMonthSelected && showClientView ? currentPreviewOutstandingUsd : 0), 0)
  const combinedExposureUsd = Math.max(dueNowUsd + (isCurrentMonthSelected && showClientView ? currentPreviewOutstandingUsd : 0), 0)
  const remainingUsd = Math.max(isCurrentMonthSelected && showClientView ? dueStatementUsd - currentPreviewOutstandingUsd : dueStatementUsd, 0)
  const creditUsd = Math.max(-(isCurrentMonthSelected && showClientView ? dueStatementUsd - currentPreviewOutstandingUsd : dueStatementUsd), 0)

  const confirmedPaidUsd = payments
    .filter((payment) => payment.status === 'confirmed')
    .reduce((acc, payment) => acc + Number(payment.amount_usd || 0), 0)

  const reportedUsd = payments
    .filter((payment) => payment.status === 'reported')
    .reduce((acc, payment) => acc + Number(payment.amount_usd || 0), 0)

  const canLockSelectedMonth = Boolean(period && showOwnerView && !period.locked_at && isPastCommissionMonth(selectedMonth))

  const handleRefresh = async () => {
    await loadPeriod(selectedMonth, true)
  }

  const uploadProofIfNeeded = async () => {
    if (!proofFile) return null

    setUploadingProof(true)
    try {
      const sanitizedName = proofFile.name.replace(/[^a-zA-Z0-9._-]/g, '-')
      const fileName = `commission-payments/${selectedMonth}/${Date.now()}-${sanitizedName}`
      const { error: uploadError } = await supabase.storage
        .from('payment_proofs')
        .upload(fileName, proofFile)

      if (uploadError) throw uploadError

      const { data } = supabase.storage.from('payment_proofs').getPublicUrl(fileName)
      return data.publicUrl
    } finally {
      setUploadingProof(false)
    }
  }

  const handleSubmitPayment = async () => {
    if (!period) return
    if (clientPaymentDisabled) return

    setSubmittingPayment(true)
    setError('')

    try {
      const proofUrl = await uploadProofIfNeeded()
      const result = await reportCommissionPaymentAction({
        periodId: period.id,
        currency: paymentForm.currency,
        amount: Number(paymentForm.amount),
        fxRateArs: paymentForm.currency === 'ARS' ? Number(paymentForm.fxRateArs) : null,
        paymentMethod: paymentForm.paymentMethod,
        reference: paymentForm.reference,
        notes: paymentForm.notes,
        proofUrl,
        paidAt: paymentForm.paidAt,
      })

      if (!result.success) {
        throw new Error(result.error || 'No se pudo registrar el pago.')
      }

      setPaymentForm({
        currency: 'USD',
        amount: '',
        fxRateArs: '',
        paymentMethod: '',
        reference: '',
        notes: '',
        paidAt: getLocalDateTimeInputValue(),
      })
      setProofFile(null)
      await loadPeriod(selectedMonth, false)
    } catch (e: any) {
      setError(e.message || 'No se pudo registrar el pago.')
    } finally {
      setSubmittingPayment(false)
    }
  }

  const handleSubmitAdjustment = async () => {
    if (!period) return

    setSubmittingAdjustment(true)
    setError('')

    try {
      const result = await createCommissionAdjustmentAction({
        periodId: period.id,
        direction: adjustmentForm.direction,
        amountUsd: Number(adjustmentForm.amountUsd),
        reason: adjustmentForm.reason,
        notes: adjustmentForm.notes,
      })

      if (!result.success) {
        throw new Error(result.error || 'No se pudo crear el ajuste.')
      }

      setAdjustmentForm({
        direction: 'debit',
        amountUsd: '',
        reason: '',
        notes: '',
      })

      await loadPeriod(selectedMonth, false)
    } catch (e: any) {
      setError(e.message || 'No se pudo crear el ajuste.')
    } finally {
      setSubmittingAdjustment(false)
    }
  }

  const handleConfirmPayment = async (paymentId: string) => {
    const result = await confirmCommissionPaymentAction(paymentId)
    if (!result.success) {
      setError(result.error || 'No se pudo confirmar el pago.')
      return
    }
    await loadPeriod(selectedMonth, false)
  }

  const handleRejectPayment = async (paymentId: string) => {
    const reason = window.prompt('Indica el motivo del rechazo de este pago:')
    if (reason === null) return

    const result = await rejectCommissionPaymentAction(paymentId, reason)
    if (!result.success) {
      setError(result.error || 'No se pudo rechazar el pago.')
      return
    }
    await loadPeriod(selectedMonth, false)
  }

  const handleLockPeriod = async () => {
    if (!period) return
    if (!window.confirm(`¿Cerrar el período ${formatCommissionPeriodLabel(selectedMonth)}? Después de cerrarlo ya no se recalculará automáticamente.`)) {
      return
    }

    const result = await lockCommissionPeriodAction(selectedMonth)
    if (!result.success) {
      setError(result.error || 'No se pudo cerrar el período.')
      return
    }

    await loadPeriod(selectedMonth, false)
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-[#9D1B1B]/10 text-[#9D1B1B] px-3 py-1 text-xs font-bold uppercase tracking-wide">
              <Receipt size={14} />
              Sistema de Comisiones
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 mt-3">Comisiones mensuales</h1>
            <p className="text-sm text-slate-600 mt-2 max-w-3xl">
              {showOwnerView ? 'Vista Perche: ves el acumulado mensual, pagos confirmados, saldo a favor y el detalle completo de ventas e importaciones.' : 'Vista Epi: ves cuánto debes pagar, el resumen del período y puedes registrar pagos parciales con trazabilidad.'}
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {isOwner && (
              <div className="inline-flex items-center rounded-xl border border-slate-200 bg-slate-50 p-1">
                <button
                  onClick={() => setViewMode('perche')}
                  className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors cursor-pointer ${viewMode === 'perche' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  Perche
                </button>
                <button
                  onClick={() => setViewMode('epi')}
                  className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors cursor-pointer ${viewMode === 'epi' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  Epi
                </button>
              </div>
            )}

            {showClientView && (
              <div className="inline-flex items-center rounded-xl border border-slate-200 bg-slate-50 p-1">
                {payableMonthKey !== currentMonthKey && (
                  <button
                    onClick={() => setSelectedMonth(payableMonthKey)}
                    className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors cursor-pointer ${selectedMonth === payableMonthKey ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                  >
                    Mes a pagar
                  </button>
                )}
                <button
                  onClick={() => setSelectedMonth(clampCommissionMonthKey(currentMonthKey))}
                  className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors cursor-pointer ${selectedMonth === currentMonthKey ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  Mes en curso
                </button>
              </div>
            )}

            <div className="inline-flex items-center rounded-xl border border-slate-200 bg-slate-50 p-1">
              <button
                onClick={() => setSelectedMonth((prev) => clampCommissionMonthKey(shiftCommissionMonthKey(prev, -1)))}
                disabled={selectedMonth <= COMMISSION_START_PERIOD_KEY}
                className="p-2 rounded-lg text-slate-600 hover:bg-white hover:text-slate-900 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <ChevronLeft size={18} />
              </button>
              <div className="px-4 min-w-[190px] text-center">
                <div className="text-xs uppercase font-bold tracking-wide text-slate-500">Período</div>
                <div className="text-sm sm:text-base font-bold text-slate-900 capitalize">{formatCommissionPeriodLabel(selectedMonth)}</div>
              </div>
              <button
                onClick={() => setSelectedMonth((prev) => shiftCommissionMonthKey(prev, 1))}
                disabled={selectedMonth >= getCurrentCommissionMonthKey()}
                className="p-2 rounded-lg text-slate-600 hover:bg-white hover:text-slate-900 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <ChevronRight size={18} />
              </button>
            </div>

            <button
              onClick={handleRefresh}
              disabled={syncing}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white px-4 py-2.5 text-sm font-bold transition-colors disabled:opacity-60 cursor-pointer"
            >
              {syncing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              Actualizar período
            </button>

            {canLockSelectedMonth && (
              <button
                onClick={handleLockPeriod}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#9D1B1B] hover:bg-[#7E1515] text-white px-4 py-2.5 text-sm font-bold transition-colors cursor-pointer"
              >
                <Lock size={16} />
                Cerrar mes
              </button>
            )}
          </div>
        </div>

        {isPreviewingClientView && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Estás viendo la vista del cliente `crimsoncrownimports@gmail.com` en modo simulación. Puedes volver a `Perche` para ver el panel completo de administración.
          </div>
        )}

        {isPreviewingClientView && (
          <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
            {isCurrentMonthSelected
              ? 'Este es el mes en curso: aquí Epi ve cómo va acumulando la comisión, pero este período se paga el mes siguiente.'
              : 'Se paga a mes vencido: el monto mostrado corresponde al período seleccionado más cualquier deuda confirmada pendiente de meses anteriores.'}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          {period && (
            <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border font-bold ${periodStatusClasses(period.status)}`}>
              {period.locked_at ? <Lock size={13} /> : <Clock3 size={13} />}
              {period.locked_at ? 'Cerrado' : 'Abierto'} · {formatPeriodStatus(period.status)}
            </span>
          )}
          {period?.last_refreshed_at && (
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-200 bg-slate-50 text-slate-600 font-medium">
              <RefreshCw size={13} />
              Última actualización: {new Date(period.last_refreshed_at).toLocaleString('es-AR')}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
          <AlertCircle size={18} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-12 flex items-center justify-center">
          <div className="flex items-center gap-3 text-slate-600">
            <Loader2 className="animate-spin" size={20} />
            Cargando comisiones del período...
          </div>
        </div>
      ) : !period ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-10 text-center">
          <div className="mx-auto w-14 h-14 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center mb-4">
            <FileText size={26} />
          </div>
          <h2 className="text-xl font-bold text-slate-900">No hay datos para este período</h2>
          <p className="text-sm text-slate-600 mt-2 max-w-2xl mx-auto">
            El período todavía no tiene snapshot generado o aún no hay operaciones con elegibilidad de comisión registradas para este mes.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-7 gap-4">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center gap-3 text-slate-500 text-sm font-bold uppercase tracking-wide">
                <Wallet size={18} className="text-[#9D1B1B]" />
                Fijo mensual
              </div>
              <div className="mt-3 text-2xl font-extrabold text-slate-900">{formatUsd(fixedFeeLine?.commission_amount_usd || period.fixed_fee_usd)}</div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center gap-3 text-slate-500 text-sm font-bold uppercase tracking-wide">
                <ShoppingBag size={18} className="text-emerald-600" />
                Ventas
              </div>
              <div className="mt-3 text-2xl font-extrabold text-slate-900">{formatUsd(period.sales_commission_usd)}</div>
              <div className="text-xs text-slate-500 mt-1">Base: {formatUsd(period.sales_base_usd)}</div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center gap-3 text-slate-500 text-sm font-bold uppercase tracking-wide">
                <Plane size={18} className="text-sky-600" />
                Importaciones
              </div>
              <div className="mt-3 text-2xl font-extrabold text-slate-900">{formatUsd(period.imports_commission_usd)}</div>
              <div className="text-xs text-slate-500 mt-1">Base: {formatUsd(period.imports_base_usd)}</div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center gap-3 text-slate-500 text-sm font-bold uppercase tracking-wide">
                <Receipt size={18} className="text-purple-600" />
                Total período
              </div>
              <div className="mt-3 text-2xl font-extrabold text-slate-900">{formatUsd(effectiveTotalDueUsd)}</div>
              <div className="text-xs text-slate-500 mt-1">Ajustes netos: {formatUsd(selectedBalance?.adjustmentsTotal || 0)}</div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center gap-3 text-slate-500 text-sm font-bold uppercase tracking-wide">
                <Landmark size={18} className={carryoverUsd > 0 ? 'text-[#9D1B1B]' : 'text-emerald-600'} />
                Arrastre
              </div>
              <div className={`mt-3 text-2xl font-extrabold ${carryoverUsd > 0 ? 'text-slate-900' : 'text-emerald-700'}`}>{formatUsd(carryoverUsd)}</div>
              <div className="text-xs text-slate-500 mt-1">Balance acumulado de períodos anteriores.</div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center gap-3 text-slate-500 text-sm font-bold uppercase tracking-wide">
                <CheckCircle2 size={18} className="text-emerald-600" />
                Pagado
              </div>
              <div className="mt-3 text-2xl font-extrabold text-slate-900">{formatUsd(confirmedPaidUsd)}</div>
              {reportedUsd > 0 && <div className="text-xs text-amber-600 mt-1">Pendiente de confirmar: {formatUsd(reportedUsd)}</div>}
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center gap-3 text-slate-500 text-sm font-bold uppercase tracking-wide">
                <Landmark size={18} className={creditUsd > 0 ? 'text-emerald-600' : 'text-[#9D1B1B]'} />
                {showOwnerView ? 'Saldo neto' : isCurrentMonthSelected ? 'Pendiente vencido' : 'Total a pagar'}
              </div>
              <div className={`mt-3 text-2xl font-extrabold ${creditUsd > 0 ? 'text-emerald-700' : 'text-slate-900'}`}>
                {creditUsd > 0 ? formatUsd(creditUsd) : formatUsd(remainingUsd)}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {creditUsd > 0 ? 'Saldo a favor acumulado.' : showOwnerView ? 'Restante pendiente de cobro.' : isCurrentMonthSelected ? 'Lo vencido sigue pendiente mientras este mes solo se acumula.' : 'Monto que falta pagar.'}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2 space-y-6">
              {showOwnerView ? (
                <>
                  <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 sm:p-6">
                    <div className="flex items-center justify-between gap-3 mb-4">
                      <div>
                        <h2 className="text-lg font-bold text-slate-900">Ventas de stock comisionadas</h2>
                        <p className="text-sm text-slate-500">Órdenes que entraron por primera vez en estado cobrable durante el período.</p>
                      </div>
                      <span className="text-sm font-bold text-slate-700">{salesLines.length} órdenes</span>
                    </div>

                    <div className="space-y-3">
                      {salesLines.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500 text-center">
                          No hay ventas comisionadas en este período.
                        </div>
                      ) : salesLines.map((line) => (
                        <div key={line.id} className="rounded-xl border border-slate-200 p-4 hover:border-slate-300 transition-colors">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-slate-900">{line.source_label}</span>
                                {line.source_status && (
                                  <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-bold text-slate-600">
                                    {line.source_status}
                                  </span>
                                )}
                              </div>
                              <div className="text-sm text-slate-500">
                                Base {formatUsd(line.base_amount_usd)} · Comisión {formatUsd(line.commission_amount_usd)}
                              </div>
                              <div className="text-xs text-slate-400">
                                Elegible desde {line.source_eligible_at ? new Date(line.source_eligible_at).toLocaleString('es-AR') : 'N/D'}
                              </div>
                            </div>

                            {line.source_id && (
                              <Link
                                href={`/admin/orders/${line.source_id}`}
                                className="inline-flex items-center gap-2 text-sm font-bold text-[#9D1B1B] hover:text-[#7E1515]"
                              >
                                Ver orden
                                <ExternalLink size={14} />
                              </Link>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 sm:p-6">
                    <div className="flex items-center justify-between gap-3 mb-4">
                      <div>
                        <h2 className="text-lg font-bold text-slate-900">Importaciones comisionadas</h2>
                        <p className="text-sm text-slate-500">Órdenes de importación que entraron por primera vez en estado cobrable durante el período.</p>
                      </div>
                      <span className="text-sm font-bold text-slate-700">{importLines.length} órdenes</span>
                    </div>

                    <div className="space-y-3">
                      {importLines.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500 text-center">
                          No hay importaciones comisionadas en este período.
                        </div>
                      ) : importLines.map((line) => (
                        <div key={line.id} className="rounded-xl border border-slate-200 p-4 hover:border-slate-300 transition-colors">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-slate-900">{line.source_label}</span>
                                {line.source_status && (
                                  <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-bold text-slate-600">
                                    {line.source_status}
                                  </span>
                                )}
                              </div>
                              <div className="text-sm text-slate-500">
                                Base {formatUsd(line.base_amount_usd)} · Comisión {formatUsd(line.commission_amount_usd)}
                              </div>
                              <div className="text-xs text-slate-400">
                                Elegible desde {line.source_eligible_at ? new Date(line.source_eligible_at).toLocaleString('es-AR') : 'N/D'}
                              </div>
                            </div>

                            {line.source_id && (
                              <Link
                                href={`/admin/imports/${line.source_id}`}
                                className="inline-flex items-center gap-2 text-sm font-bold text-[#9D1B1B] hover:text-[#7E1515]"
                              >
                                Ver importación
                                <ExternalLink size={14} />
                              </Link>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                </>
              ) : (
                <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 sm:p-6">
                  <div className="flex items-center justify-between gap-3 mb-4">
                    <div>
                      <h2 className="text-lg font-bold text-slate-900">Resumen de la comisión del período</h2>
                      <p className="text-sm text-slate-500">Aquí ves de dónde sale el total a pagar este mes.</p>
                    </div>
                    <span className="text-sm font-bold text-slate-700">{salesLines.length + importLines.length} operaciones</span>
                  </div>

                  <div className="space-y-4">
                    {isCurrentMonthSelected && (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <h3 className="font-bold text-slate-900">Mes en curso</h3>
                            <p className="text-sm text-slate-600">Este acumulado es informativo: corresponde al mes actual y se paga recién el próximo mes.</p>
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-extrabold text-slate-900">{formatUsd(currentPreviewOutstandingUsd)}</div>
                            <div className="text-xs text-slate-500">Comisión acumulada del mes actual</div>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h3 className="font-bold text-slate-900">Costo fijo mensual</h3>
                          <p className="text-sm text-slate-500">Abono base del servicio web.</p>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-extrabold text-slate-900">{formatUsd(fixedFeeLine?.commission_amount_usd || period.fixed_fee_usd)}</div>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h3 className="font-bold text-slate-900">Ventas de stock</h3>
                          <p className="text-sm text-slate-500">{salesLines.length} órdenes cobrables durante el período.</p>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-extrabold text-slate-900">{formatUsd(period.sales_commission_usd)}</div>
                          <div className="text-xs text-slate-500">Base {formatUsd(period.sales_base_usd)}</div>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h3 className="font-bold text-slate-900">Importaciones</h3>
                          <p className="text-sm text-slate-500">{importLines.length} órdenes cobrables durante el período.</p>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-extrabold text-slate-900">{formatUsd(period.imports_commission_usd)}</div>
                          <div className="text-xs text-slate-500">Base {formatUsd(period.imports_base_usd)}</div>
                        </div>
                      </div>
                    </div>

                    {carryoverUsd !== 0 && (
                      <div className="rounded-xl border border-slate-200 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <h3 className="font-bold text-slate-900">Arrastre de períodos anteriores</h3>
                            <p className="text-sm text-slate-500">Deuda o saldo acumulado hasta antes del período seleccionado.</p>
                          </div>
                          <div className={`text-lg font-extrabold ${carryoverUsd > 0 ? 'text-slate-900' : 'text-emerald-700'}`}>{formatUsd(carryoverUsd)}</div>
                        </div>
                        <div className="mt-3 space-y-2">
                          {priorBalances.filter((item) => item.outstandingUsd !== 0).map((item) => (
                            <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                              <span className="text-slate-700">{formatCommissionPeriodLabel(item.period_key)}</span>
                              <span className={`font-bold ${item.outstandingUsd > 0 ? 'text-slate-900' : 'text-emerald-700'}`}>{formatUsd(item.outstandingUsd)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {selectedAdjustments.length > 0 && (
                      <div className="rounded-xl border border-slate-200 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <h3 className="font-bold text-slate-900">Ajustes manuales del período</h3>
                            <p className="text-sm text-slate-500">Movimientos agregados por Perche con motivo visible.</p>
                          </div>
                          <div className="text-lg font-extrabold text-slate-900">{formatUsd(selectedBalance?.adjustmentsTotal || 0)}</div>
                        </div>
                        <div className="mt-3 space-y-2">
                          {selectedAdjustments.map((adjustment) => {
                            const signedAmount = adjustment.direction === 'debit'
                              ? Number(adjustment.amount_usd || 0)
                              : -Number(adjustment.amount_usd || 0)

                            return (
                              <div key={adjustment.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                                <div className="flex items-center justify-between gap-3">
                                  <span className="font-bold text-slate-800">{adjustment.reason}</span>
                                  <span className={`font-bold ${signedAmount >= 0 ? 'text-slate-900' : 'text-emerald-700'}`}>{formatUsd(signedAmount)}</span>
                                </div>
                                {adjustment.notes && <div className="mt-1 text-slate-500">{adjustment.notes}</div>}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    <div className="rounded-xl border border-[#9D1B1B]/20 bg-[#9D1B1B]/5 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h3 className="font-bold text-slate-900">{isCurrentMonthSelected ? 'Total acumulado' : 'Total a pagar'}</h3>
                          <p className="text-sm text-slate-600">
                            {isCurrentMonthSelected ? 'Suma de la deuda vencida pendiente más lo que ya se acumuló en el mes actual.' : 'Suma del período seleccionado más la deuda confirmada pendiente arrastrada FIFO.'}
                          </p>
                        </div>
                        <div className="text-right">
                          <div className="text-2xl font-extrabold text-[#9D1B1B]">{formatUsd(isCurrentMonthSelected ? combinedExposureUsd : remainingUsd)}</div>
                          <div className="text-xs text-slate-500">{isCurrentMonthSelected ? `Deuda vencida hoy ${formatUsd(dueNowUsd)}` : `Restante actual ${formatUsd(remainingUsd)}`}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
              )}
            </div>

            <div className="space-y-6">
              {showOwnerView && (
                <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 sm:p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center">
                      <Landmark size={18} />
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-slate-900">Ajuste manual</h2>
                      <p className="text-sm text-slate-500">Permite sumar o restar importes con motivo visible en el resumen del período.</p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-bold uppercase tracking-wide text-slate-500 block mb-1">Tipo</label>
                        <select
                          value={adjustmentForm.direction}
                          onChange={(e) => setAdjustmentForm((prev) => ({ ...prev, direction: e.target.value as 'debit' | 'credit' }))}
                          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#9D1B1B]"
                        >
                          <option value="debit">Sumar deuda</option>
                          <option value="credit">Restar deuda</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-xs font-bold uppercase tracking-wide text-slate-500 block mb-1">Monto USD</label>
                        <input
                          type="number"
                          value={adjustmentForm.amountUsd}
                          onChange={(e) => setAdjustmentForm((prev) => ({ ...prev, amountUsd: e.target.value }))}
                          placeholder="23.00"
                          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#9D1B1B]"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-bold uppercase tracking-wide text-slate-500 block mb-1">Motivo visible</label>
                      <input
                        value={adjustmentForm.reason}
                        onChange={(e) => setAdjustmentForm((prev) => ({ ...prev, reason: e.target.value }))}
                        placeholder="Ej: saldo pendiente del mes anterior"
                        className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#9D1B1B]"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-bold uppercase tracking-wide text-slate-500 block mb-1">Notas internas</label>
                      <textarea
                        rows={3}
                        value={adjustmentForm.notes}
                        onChange={(e) => setAdjustmentForm((prev) => ({ ...prev, notes: e.target.value }))}
                        placeholder="Aclaración opcional para el equipo."
                        className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#9D1B1B] resize-none"
                      />
                    </div>

                    <button
                      onClick={handleSubmitAdjustment}
                      disabled={submittingAdjustment || !period}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white px-4 py-3 font-bold transition-colors disabled:opacity-60 cursor-pointer"
                    >
                      {submittingAdjustment ? <Loader2 size={18} className="animate-spin" /> : <Landmark size={18} />}
                      Guardar ajuste
                    </button>
                  </div>
                </section>
              )}

              <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 sm:p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-[#9D1B1B]/10 text-[#9D1B1B] flex items-center justify-center">
                    <Upload size={18} />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">Registrar pago</h2>
                    <p className="text-sm text-slate-500">
                      {clientPaymentDisabled
                        ? 'Este mes está en curso y todavía no se paga. Puedes revisar el acumulado, pero el pago corresponde al siguiente mes.'
                        : 'Permite pagos parciales en USD o ARS, con referencia y comprobante.'}
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold uppercase tracking-wide text-slate-500 block mb-1">Moneda</label>
                      <select
                        value={paymentForm.currency}
                        onChange={(e) => setPaymentForm((prev) => ({ ...prev, currency: e.target.value as 'USD' | 'ARS' }))}
                        disabled={clientPaymentDisabled}
                        className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#9D1B1B]"
                      >
                        <option value="USD">USD</option>
                        <option value="ARS">ARS</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-xs font-bold uppercase tracking-wide text-slate-500 block mb-1">Monto</label>
                      <input
                        type="number"
                        value={paymentForm.amount}
                        onChange={(e) => setPaymentForm((prev) => ({ ...prev, amount: e.target.value }))}
                        disabled={clientPaymentDisabled}
                        placeholder={paymentForm.currency === 'USD' ? '100.00' : '150000.00'}
                        className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#9D1B1B]"
                      />
                    </div>
                  </div>

                  {paymentForm.currency === 'ARS' && (
                    <div>
                      <label className="text-xs font-bold uppercase tracking-wide text-slate-500 block mb-1">Tipo de cambio aplicado</label>
                      <input
                        type="number"
                        value={paymentForm.fxRateArs}
                        onChange={(e) => setPaymentForm((prev) => ({ ...prev, fxRateArs: e.target.value }))}
                        disabled={clientPaymentDisabled}
                        placeholder="Ej: 1180"
                        className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#9D1B1B]"
                      />
                      {paymentForm.fxRateArs && paymentForm.amount && (
                        <p className="mt-1 text-xs text-slate-500">
                          Equivale a {formatUsd(Number(paymentForm.amount || 0) / Number(paymentForm.fxRateArs || 1))}
                        </p>
                      )}
                    </div>
                  )}

                  <div>
                    <label className="text-xs font-bold uppercase tracking-wide text-slate-500 block mb-1">Cómo se realizó el pago</label>
                    <input
                      value={paymentForm.paymentMethod}
                      onChange={(e) => setPaymentForm((prev) => ({ ...prev, paymentMethod: e.target.value }))}
                      disabled={clientPaymentDisabled}
                      placeholder="Ej: Transferencia bancaria, efectivo, PayPal..."
                      className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#9D1B1B]"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold uppercase tracking-wide text-slate-500 block mb-1">Referencia</label>
                      <input
                        value={paymentForm.reference}
                        onChange={(e) => setPaymentForm((prev) => ({ ...prev, reference: e.target.value }))}
                        disabled={clientPaymentDisabled}
                        placeholder="N° de operación o dato útil"
                        className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#9D1B1B]"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-bold uppercase tracking-wide text-slate-500 block mb-1">Fecha y hora del pago</label>
                      <input
                        type="datetime-local"
                        value={paymentForm.paidAt}
                        onChange={(e) => setPaymentForm((prev) => ({ ...prev, paidAt: e.target.value }))}
                        disabled={clientPaymentDisabled}
                        className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#9D1B1B]"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-bold uppercase tracking-wide text-slate-500 block mb-1">Observaciones</label>
                    <textarea
                      rows={3}
                      value={paymentForm.notes}
                      onChange={(e) => setPaymentForm((prev) => ({ ...prev, notes: e.target.value }))}
                      disabled={clientPaymentDisabled}
                      placeholder="Detalle libre del pago, parcialidad, aclaraciones, etc."
                      className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#9D1B1B] resize-none"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-bold uppercase tracking-wide text-slate-500 block mb-1">Comprobante</label>
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      onChange={(e) => setProofFile(e.target.files?.[0] || null)}
                      disabled={clientPaymentDisabled}
                      className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-bold file:text-slate-700 cursor-pointer"
                    />
                    {proofFile && <p className="mt-1 text-xs text-slate-500">Archivo seleccionado: {proofFile.name}</p>}
                  </div>

                  <button
                    onClick={handleSubmitPayment}
                    disabled={submittingPayment || uploadingProof || !period || clientPaymentDisabled}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#9D1B1B] hover:bg-[#7E1515] text-white px-4 py-3 font-bold transition-colors disabled:opacity-60 cursor-pointer"
                  >
                    {(submittingPayment || uploadingProof) ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
                    {clientPaymentDisabled ? 'Se paga el próximo mes' : showOwnerView ? 'Registrar pago confirmado' : 'Registrar pago'}
                  </button>
                </div>
              </section>

              <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 sm:p-6">
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">Pagos del período</h2>
                    <p className="text-sm text-slate-500">Historial de pagos reportados y confirmados.</p>
                  </div>
                  <span className="text-sm font-bold text-slate-700">{payments.length}</span>
                </div>

                <div className="space-y-3">
                  {payments.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500 text-center">
                      Todavía no hay pagos cargados para este período.
                    </div>
                  ) : payments.map((payment) => (
                    <div key={payment.id} className="rounded-xl border border-slate-200 p-4 space-y-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold ${paymentStatusClasses(payment.status)}`}>
                              {formatPaymentStatus(payment.status)}
                            </span>
                            <span className="font-bold text-slate-900">{payment.payment_method}</span>
                          </div>
                          <div className="text-sm text-slate-500 mt-1">
                            {payment.currency === 'USD' ? formatUsd(payment.amount) : `${formatArs(payment.amount)} · ${formatUsd(payment.amount_usd)}`}
                          </div>
                        </div>

                        <div className="text-xs text-slate-400">
                          {new Date(payment.paid_at).toLocaleString('es-AR')}
                        </div>
                      </div>

                      {payment.currency === 'ARS' && payment.fx_rate_ars && (
                        <div className="text-xs text-slate-500">Tipo de cambio aplicado: {payment.fx_rate_ars}</div>
                      )}

                      {payment.reference && (
                        <div className="text-sm text-slate-600">
                          <span className="font-bold text-slate-700">Referencia:</span> {payment.reference}
                        </div>
                      )}

                      {payment.notes && (
                        <div className="text-sm text-slate-600">
                          <span className="font-bold text-slate-700">Notas:</span> {payment.notes}
                        </div>
                      )}

                      {payment.rejection_reason && (
                        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                          <span className="font-bold">Motivo del rechazo:</span> {payment.rejection_reason}
                        </div>
                      )}

                      {Number(payment.unapplied_usd || 0) > 0 && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                          <span className="font-bold">Saldo no aplicado:</span> {formatUsd(payment.unapplied_usd || 0)}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-2">
                        {payment.proof_url && (
                          <a
                            href={payment.proof_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100"
                          >
                            <ExternalLink size={14} />
                            Ver comprobante
                          </a>
                        )}

                        {showOwnerView && payment.status === 'reported' && (
                          <>
                            <button
                              onClick={() => handleConfirmPayment(payment.id)}
                              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 text-sm font-bold cursor-pointer"
                            >
                              <CheckCircle2 size={14} />
                              Confirmar
                            </button>
                            <button
                              onClick={() => handleRejectPayment(payment.id)}
                              className="inline-flex items-center gap-2 rounded-lg bg-red-600 hover:bg-red-700 text-white px-3 py-2 text-sm font-bold cursor-pointer"
                            >
                              <AlertCircle size={14} />
                              Rechazar
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-600">
            <span className="font-bold text-slate-800">Regla actual:</span> 100 USD fijos + 3% sobre ventas de stock exitosas + 3% sobre importaciones exitosas. Los pagos parciales se normalizan a USD para calcular deuda, restante y saldo a favor.
          </div>
        </>
      )}
    </div>
  )
}
