import HangRequestForm from '@/components/forms/HangRequestForm'

export default function Page() {
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-secondary mb-4">Colgar Pedido</h1>
      <p className="text-sm text-zinc-600 mb-4">Pegá tu lista de cartas o links y abriremos WhatsApp con el mensaje.</p>
      <HangRequestForm />
    </div>
  )
}
