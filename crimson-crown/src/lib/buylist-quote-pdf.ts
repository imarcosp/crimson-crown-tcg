import path from "path"
import { readFile } from "fs/promises"
import puppeteer from "puppeteer"
import { createGuardedSupabaseClient as createAdminClient } from '@/lib/supabase/guarded-constructors'
import { siteConfig } from "@/config/site"

export type BuylistQuotePdfItem = {
  id: number | string
  product_id?: string | null
  card_name: string | null
  set_name: string | null
  collector_number: string | null
  image_url: string | null
  quantity: number | null
  offered_price_unit: number | null
  condition: string | null
  is_foil: boolean | null
  language?: string | null
}

export type BuylistQuotePdfSummary = {
  id: string
  created_at: string | null
  sent_at: string | null
  status: string | null
  total_offered: number | null
  user_id: string
  created_by_admin_id: string | null
  profile: {
    email: string | null
    first_name: string | null
    last_name: string | null
    phone: string | null
  } | null
  items: BuylistQuotePdfItem[]
}

function createServiceRoleClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function escapeHtml(value: string | number | null | undefined) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function usd(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0))
}

function formatDate(value: string | null) {
  if (!value) return "-"
  return new Date(value).toLocaleString("es-AR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function fullName(summary: BuylistQuotePdfSummary) {
  const first = String(summary.profile?.first_name || "").trim()
  const last = String(summary.profile?.last_name || "").trim()
  return [first, last].filter(Boolean).join(" ") || "Cliente"
}

function getStatusLabel(status: string | null) {
  const safe = String(status || "").toLowerCase()
  if (safe === "draft") return "Borrador"
  if (safe === "waiting_user_approval") return "Pendiente de tu respuesta"
  if (safe === "completed") return "Completada"
  if (safe === "rejected") return "Rechazada"
  if (safe === "cancelled") return "Cancelada"
  if (safe === "pending_review") return "En revisión"
  return safe || "Sin estado"
}

function getFinishLabel(item: BuylistQuotePdfItem) {
  return item.is_foil ? "Foil" : "Non-Foil"
}

async function fetchImageAsDataUrl(url: string | null | undefined) {
  const safeUrl = String(url || "").trim()
  if (!safeUrl) return null

  try {
    const response = await fetch(safeUrl, { cache: "no-store" })
    if (!response.ok) return safeUrl
    const contentType = response.headers.get("content-type") || "image/jpeg"
    const buffer = Buffer.from(await response.arrayBuffer())
    return `data:${contentType};base64,${buffer.toString("base64")}`
  } catch {
    return safeUrl
  }
}

async function getLogoDataUrl() {
  const logoPath = path.join(process.cwd(), "public", "logo.webp")
  const file = await readFile(logoPath)
  return `data:image/webp;base64,${file.toString("base64")}`
}

function buildBuylistQuoteHtml(summary: BuylistQuotePdfSummary, logoUrl: string) {
  const rows =
    summary.items.length === 0
      ? `
        <tr>
          <td colspan="6" class="empty-row">La cotización aún no tiene cartas cargadas.</td>
        </tr>
      `
      : summary.items
          .map((item) => {
            const quantity = Math.max(1, Number(item.quantity || 1))
            const unit = Number(item.offered_price_unit || 0)
            const total = unit * quantity
            const detail = [item.condition, item.language, getFinishLabel(item)].filter(Boolean).join(" · ")
            const image = item.image_url
              ? `<img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.card_name || "Carta")}" class="card-thumb" />`
              : `<div class="card-thumb placeholder">Sin foto</div>`
            return `
              <tr>
                <td>${image}</td>
                <td>
                  <div class="item-name">${escapeHtml(item.card_name || "Carta")}</div>
                  <div class="item-set">${escapeHtml(item.set_name || "Set desconocido")} ${item.collector_number ? `#${escapeHtml(item.collector_number)}` : ""}</div>
                </td>
                <td>${escapeHtml(detail || "-")}</td>
                <td class="num">${escapeHtml(quantity)}</td>
                <td class="num">${escapeHtml(usd(unit))}</td>
                <td class="num">${escapeHtml(usd(total))}</td>
              </tr>
            `
          })
          .join("")

  return `
    <!DOCTYPE html>
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <title>Cotización de compra</title>
        <style>
          * { box-sizing: border-box; }
          body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #F8FAFC; color: #0F172A; }
          .page { position: relative; padding: 28px; }
          .watermark { position: absolute; top: 160px; right: 18px; opacity: 0.035; z-index: 0; }
          .watermark img { width: 260px; height: 260px; object-fit: contain; }
          .content { position: relative; z-index: 1; }
          .header { display: flex; justify-content: space-between; gap: 20px; align-items: center; padding: 24px; border-radius: 24px; background: linear-gradient(135deg, #0F172A 0%, #1E293B 100%); color: white; }
          .brand { display: flex; align-items: center; gap: 16px; }
          .brand img { width: 70px; height: 70px; object-fit: contain; border-radius: 18px; background: rgba(255,255,255,0.08); padding: 8px; }
          .eyebrow { margin: 0 0 6px 0; font-size: 12px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #FCA5A5; }
          .title { margin: 0; font-size: 28px; font-weight: 800; }
          .subtitle { margin: 8px 0 0 0; font-size: 13px; color: #CBD5E1; }
          .header-side { min-width: 220px; display: flex; flex-direction: column; align-items: flex-end; gap: 10px; }
          .chip { display: inline-flex; align-items: center; padding: 8px 12px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.16); background: rgba(255,255,255,0.08); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
          .total-box { padding: 14px 16px; border-radius: 18px; background: rgba(255,255,255,0.1); text-align: right; }
          .total-label { font-size: 12px; color: #CBD5E1; margin: 0; }
          .total-value { font-size: 28px; font-weight: 800; margin: 6px 0 0 0; }
          .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-top: 22px; }
          .card { background: white; border: 1px solid #E2E8F0; border-radius: 18px; padding: 18px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.06); }
          .card-label { margin: 0 0 8px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700; color: #64748B; }
          .card-value { margin: 0; font-size: 15px; font-weight: 700; color: #0F172A; line-height: 1.45; word-break: break-word; }
          .card-subvalue { margin: 6px 0 0 0; font-size: 12px; color: #64748B; }
          .section { margin-top: 24px; background: white; border: 1px solid #E2E8F0; border-radius: 22px; padding: 22px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.05); }
          .section-title { margin: 0 0 16px 0; font-size: 18px; font-weight: 800; color: #0F172A; }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 12px 10px; border-bottom: 1px solid #E2E8F0; vertical-align: top; font-size: 12px; }
          th { background: #F8FAFC; color: #475569; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; text-align: left; }
          .item-name { font-size: 13px; font-weight: 700; color: #0F172A; }
          .card-thumb { width: 54px; height: 76px; object-fit: cover; border-radius: 10px; border: 1px solid #CBD5E1; background: #F8FAFC; display: block; }
          .card-thumb.placeholder { display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: #94A3B8; text-align: center; padding: 6px; }
          .item-set { margin-top: 4px; color: #64748B; font-size: 11px; }
          .num { text-align: right; white-space: nowrap; }
          .empty-row { text-align: center; color: #64748B; padding: 26px 12px; }
          .footer-note { margin-top: 18px; padding: 14px 16px; border-radius: 16px; background: #FEF2F2; border: 1px solid #FECACA; color: #991B1B; font-size: 12px; line-height: 1.6; }
        </style>
      </head>
      <body>
        <div class="page">
          <div class="watermark"><img src="${logoUrl}" alt="" /></div>
          <div class="content">
            <div class="header">
              <div class="brand">
                <img src="${logoUrl}" alt="${escapeHtml(siteConfig.shortName)}" />
                <div>
                  <p class="eyebrow">${escapeHtml(siteConfig.shortName)}</p>
                  <h1 class="title">Cotización de compra</h1>
                  <p class="subtitle">Resumen generado por el staff para la recepción de cartas en tienda.</p>
                </div>
              </div>
              <div class="header-side">
                <span class="chip">#${escapeHtml(summary.id.slice(0, 8).toUpperCase())}</span>
                <div class="total-box">
                  <p class="total-label">Total ofertado</p>
                  <p class="total-value">${escapeHtml(usd(summary.total_offered))}</p>
                </div>
              </div>
            </div>

            <div class="grid">
              <div class="card">
                <p class="card-label">Cliente</p>
                <p class="card-value">${escapeHtml(fullName(summary))}</p>
                <p class="card-subvalue">${escapeHtml(summary.profile?.email || "Sin email")}</p>
              </div>
              <div class="card">
                <p class="card-label">Estado</p>
                <p class="card-value">${escapeHtml(getStatusLabel(summary.status))}</p>
                <p class="card-subvalue">Enviado: ${escapeHtml(formatDate(summary.sent_at))}</p>
              </div>
              <div class="card">
                <p class="card-label">Fechas</p>
                <p class="card-value">Creada: ${escapeHtml(formatDate(summary.created_at))}</p>
                <p class="card-subvalue">Última versión: ${escapeHtml(formatDate(summary.sent_at || summary.created_at))}</p>
              </div>
            </div>

            <div class="section">
              <h2 class="section-title">Detalle de cartas</h2>
              <table>
                <thead>
                  <tr>
                    <th>Imagen</th>
                    <th>Carta</th>
                    <th>Detalle</th>
                    <th class="num">Cant.</th>
                    <th class="num">Oferta unit.</th>
                    <th class="num">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows}
                </tbody>
              </table>
              <div class="footer-note">
                Esta cotización es una propuesta del staff basada en la versión y el estado indicados al momento de la carga.
                La acreditación final queda sujeta a la revisión física de las cartas en tienda. Una vez aceptada y validada, el monto se acredita como créditos de tienda para usar enseguida en la web.
              </div>
            </div>
          </div>
        </div>
      </body>
    </html>
  `
}

export async function getBuylistQuotePdfSummary(buylistId: string): Promise<BuylistQuotePdfSummary> {
  const admin = createServiceRoleClient()
  const { data: order, error } = await admin
    .from("buylist_orders")
    .select("id, created_at, sent_at, status, total_offered, user_id, created_by_admin_id, buylist_items(id, product_id, card_name, set_name, collector_number, image_url, quantity, offered_price_unit, condition, is_foil)")
    .eq("id", buylistId)
    .single()

  if (error || !order?.id) {
    throw new Error(error?.message || "No encontramos la cotización.")
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("email, first_name, last_name, phone")
    .eq("id", order.user_id)
    .single()

  const itemList = Array.isArray(order.buylist_items) ? order.buylist_items : []
  const productIds = itemList
    .map((item: any) => String(item?.product_id || "").trim())
    .filter(Boolean)
  const { data: productsData } = productIds.length
    ? await admin
        .from("products")
        .select("id, image_url, language")
        .in("id", productIds)
    : { data: [] as any[] }
  const productMap = new Map((productsData || []).map((product: any) => [String(product.id), product]))

  const items = await Promise.all(
    itemList.map(async (item: any) => {
      const product = productMap.get(String(item?.product_id || "")) || null
      const resolvedImage = item?.image_url || product?.image_url || null
      return {
        ...item,
        image_url: await fetchImageAsDataUrl(resolvedImage),
        language: product?.language || null,
      }
    })
  )

  return {
    id: String(order.id),
    created_at: order.created_at || null,
    sent_at: order.sent_at || null,
    status: order.status || null,
    total_offered: Number(order.total_offered || 0),
    user_id: String(order.user_id),
    created_by_admin_id: order.created_by_admin_id || null,
    profile: profile || null,
    items,
  }
}

export function getBuylistQuotePdfFileName(summary: BuylistQuotePdfSummary) {
  return `cotizacion-compra-${summary.id.slice(0, 8)}.pdf`
}

export async function generateBuylistQuotePdfBuffer(summary: BuylistQuotePdfSummary) {
  const logoUrl = await getLogoDataUrl()
  const html = buildBuylistQuoteHtml(summary, logoUrl)

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  })

  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: "domcontentloaded" })
    return Buffer.from(
      await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "18px", right: "18px", bottom: "18px", left: "18px" },
      })
    )
  } finally {
    await browser.close()
  }
}
