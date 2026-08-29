import { Resend } from 'resend'

let cachedClient: Resend | null = null
let cachedApiKey = ''

export function getResendClient(apiKey = process.env.RESEND_API_KEY) {
  const normalizedKey = String(apiKey || '').trim()
  if (!normalizedKey) throw new Error('El servicio de correo no está configurado.')

  if (!cachedClient || cachedApiKey !== normalizedKey) {
    cachedClient = new Resend(normalizedKey)
    cachedApiKey = normalizedKey
  }
  return cachedClient
}
