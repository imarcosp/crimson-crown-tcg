import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { ADMIN_EMAILS } from "@/lib/constants"
import {
  generateBuylistQuotePdfBuffer,
  getBuylistQuotePdfFileName,
  getBuylistQuotePdfSummary,
} from "@/lib/buylist-quote-pdf"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function getCurrentUserAccess(summaryUserId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { allowed: false, isAdmin: false }
  }

  const isAdmin = Boolean(user.email && ADMIN_EMAILS.includes(user.email))
  return {
    allowed: user.id === summaryUserId || isAdmin,
    isAdmin,
  }
}

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const summary = await getBuylistQuotePdfSummary(id)
    const { allowed, isAdmin } = await getCurrentUserAccess(summary.user_id)
    const isUnsentManualDraft = Boolean(summary.created_by_admin_id) && !summary.sent_at

    if (!allowed || (isUnsentManualDraft && !isAdmin)) {
      return NextResponse.json({ error: "Acceso denegado." }, { status: 403 })
    }

    const pdfBuffer = await generateBuylistQuotePdfBuffer(summary)
    const fileName = getBuylistQuotePdfFileName(summary)

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "No se pudo generar el PDF." }, { status: 500 })
  }
}
