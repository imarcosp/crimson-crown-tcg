export type CheckoutAddress = {
  street?: string | null
  city?: string | null
  province?: string | null
  zip?: string | null
}

export type CheckoutDeliveryMethod = 'pickup' | 'moto' | 'shipping'

/**
 * The cart UI appends the selected payment label to the delivery method so
 * that the order detail can show both values. Checkout validation must use the
 * base delivery method instead of comparing that decorated value literally.
 */
export function getCheckoutDeliveryMethod(method?: string | null): CheckoutDeliveryMethod | null {
  const normalized = String(method || '').trim().toLowerCase()
  if (normalized.startsWith('pickup')) return 'pickup'
  if (normalized.startsWith('moto')) return 'moto'
  if (normalized.startsWith('shipping')) return 'shipping'
  return null
}

export function requiresCheckoutAddress(method?: string | null): boolean {
  const normalized = getCheckoutDeliveryMethod(method)
  return normalized === 'moto' || normalized === 'shipping'
}

export function getCheckoutShippingNote(
  method?: string | null,
  address: CheckoutAddress = {},
): string | null {
  const normalized = getCheckoutDeliveryMethod(method)
  if (!normalized) return null
  if (normalized === 'pickup') return 'Entrega: Retiro en Tienda (Almagro)'
  if (normalized === 'moto') return 'Entrega: Moto Mensajería (CABA/GBA) - A coordinar / Pago en destino'

  const hasAddress = [address.street, address.city, address.province, address.zip]
    .every((value) => value !== undefined && value !== null && String(value).trim() !== '')
  return hasAddress
    ? `Entrega: Correo Argentino | ${address.street}, ${address.city}, ${address.province} (${address.zip})`
    : 'Entrega: Correo Argentino'
}
