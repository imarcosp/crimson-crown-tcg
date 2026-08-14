"use client"
import { useForm } from 'react-hook-form'
import { useContactWhatsapp } from '@/hooks/useContactWhatsapp'
import { buildWhatsAppUrl } from '@/lib/contact-whatsapp'

type FormValues = { message: string }

export default function HangRequestForm() {
  const { register, handleSubmit, reset } = useForm<FormValues>({ defaultValues: { message: '' } })
  const whatsapp = useContactWhatsapp()

  const onSubmit = (data: FormValues) => {
    const url = buildWhatsAppUrl(whatsapp, data.message.trim())
    window.open(url, '_blank')
    reset()
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
      <label className="block text-sm font-medium">Lista de cartas o links</label>
      <textarea
        rows={8}
        {...register('message', { required: true })}
        placeholder="Pega acá tu lista o links"
        className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm"
      />
      <button type="submit" className="rounded-md bg-primary text-white px-4 py-2 text-sm">Enviar por WhatsApp</button>
    </form>
  )
}
