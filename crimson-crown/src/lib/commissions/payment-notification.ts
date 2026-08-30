type DeliveryResult = 'disabled' | 'failed' | 'sent'

export function assertNotificationProviderResult(result: unknown): void {
  const candidate = result as { data?: { id?: unknown } | null; error?: unknown } | null | undefined
  if (
    !candidate ||
    typeof candidate !== 'object' ||
    candidate.error !== null ||
    !candidate.data ||
    typeof candidate.data.id !== 'string' ||
    candidate.data.id.trim() === ''
  ) throw new Error('Notificación no entregada.')
}

export async function deliverCommissionPaymentNotification({
  disabled,
  send,
  onFailure = () => undefined,
}: {
  disabled: boolean
  send: () => Promise<unknown>
  onFailure?: () => void
}): Promise<DeliveryResult> {
  if (disabled) return 'disabled'

  try {
    await send()
    return 'sent'
  } catch {
    try {
      onFailure()
    } catch {
      // Observability must never change the outcome of an already persisted payment.
    }
    return 'failed'
  }
}
