"use client"

import { useState } from 'react'
import MercadoPagoBrick from '@/components/checkout/MercadoPagoBrick'
import MercadoPagoWallet from '@/components/checkout/MercadoPagoWallet'
import { ShoppingCart, AlertCircle, CheckCircle2, CreditCard, Wallet } from 'lucide-react'

export default function TestPaymentPage() {
  const [paymentStatus, setPaymentStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [paymentId, setPaymentId] = useState<string>('')
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [testMode, setTestMode] = useState<'card' | 'wallet'>('card')

  const amountToPay = 15000 // $15.000 ARS para la prueba

  const handleSuccess = (id: string) => {
    setPaymentStatus('success')
    setPaymentId(id)
  }

  const handleError = (error: string) => {
    setPaymentStatus('error')
    setErrorMessage(error)
  }

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4">
      <div className="max-w-xl mx-auto space-y-8">
        
        {/* Encabezado */}
        <div className="text-center">
          <h1 className="text-3xl font-extrabold text-slate-900">Checkout de Prueba</h1>
          <p className="text-slate-500 mt-2">Esta es una página aislada para probar la integración con Mercado Pago Bricks.</p>
        </div>

        {/* Resumen de Compra Simulado */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
            <ShoppingCart size={20} /> Resumen de Compra
          </h2>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">1x Booster Box Magic The Gathering</span>
              <span className="font-medium">$14.500</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Envío</span>
              <span className="font-medium">$500</span>
            </div>
            <div className="pt-3 border-t border-slate-100 flex justify-between items-end">
              <span className="font-bold text-slate-800">Total a pagar</span>
              <span className="text-2xl font-black text-[#9D1B1B]">${amountToPay.toLocaleString('es-AR')}</span>
            </div>
          </div>
        </div>

        {/* Estados de Pago */}
        {paymentStatus === 'success' && (
          <div className="bg-emerald-50 border border-emerald-200 p-6 rounded-2xl text-center animate-in fade-in zoom-in">
            <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 size={32} />
            </div>
            <h3 className="text-xl font-bold text-emerald-900 mb-2">¡Pago Exitoso!</h3>
            <p className="text-emerald-700">El pago se ha procesado correctamente en el entorno de pruebas.</p>
            <div className="mt-4 p-3 bg-white rounded-lg border border-emerald-100 font-mono text-sm text-slate-600">
              ID de Transacción: {paymentId}
            </div>
            <button 
              onClick={() => setPaymentStatus('idle')}
              className="mt-6 px-6 py-2 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-700 transition-colors"
            >
              Hacer otra prueba
            </button>
          </div>
        )}

        {paymentStatus === 'error' && (
          <div className="bg-red-50 border border-red-200 p-6 rounded-2xl text-center animate-in fade-in zoom-in">
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle size={32} />
            </div>
            <h3 className="text-xl font-bold text-red-900 mb-2">Error en el Pago</h3>
            <p className="text-red-700">{errorMessage}</p>
            <button 
              onClick={() => setPaymentStatus('idle')}
              className="mt-6 px-6 py-2 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700 transition-colors"
            >
              Reintentar
            </button>
          </div>
        )}

        {/* Componente de Mercado Pago */}
        {paymentStatus === 'idle' && (
          <div className="animate-in fade-in slide-in-from-bottom-4">
            
            <div className="flex gap-4 mb-6">
              <button 
                onClick={() => setTestMode('card')}
                className={`flex-1 py-3 px-4 rounded-xl font-bold flex items-center justify-center gap-2 border-2 transition-all ${testMode === 'card' ? 'border-[#9D1B1B] text-[#9D1B1B] bg-red-50' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
              >
                <CreditCard size={20} /> Checkout Embebido
              </button>
              <button 
                onClick={() => setTestMode('wallet')}
                className={`flex-1 py-3 px-4 rounded-xl font-bold flex items-center justify-center gap-2 border-2 transition-all ${testMode === 'wallet' ? 'border-[#009EE3] text-[#009EE3] bg-[#009EE3]/10' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
              >
                <Wallet size={20} /> Botón Wallet
              </button>
            </div>

            {testMode === 'card' ? (
              <MercadoPagoBrick 
                amount={amountToPay} 
                onPaymentSuccess={handleSuccess}
                onPaymentError={handleError}
              />
            ) : (
              <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center">
                <p className="text-sm text-slate-600 mb-6 text-center">Este botón redirige al usuario a la app o abre un modal oficial de Mercado Pago para que pague con su saldo o tarjetas guardadas.</p>
                <MercadoPagoWallet amount={amountToPay} />
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
