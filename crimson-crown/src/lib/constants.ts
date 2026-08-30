// Valor hardcodeado temporalmente hasta tener backend
// Referencia: Dólar Crypto (USDT) Venta
export const EXCHANGE_RATE = 1180
import { getAdminEmails, getOwnerAdminEmail, getStaffAdminEmail } from './auth/admin-access.ts'

export const OWNER_ADMIN_EMAIL = getOwnerAdminEmail()
export const STAFF_ADMIN_EMAIL = getStaffAdminEmail()
export const ADMIN_EMAILS = getAdminEmails()
