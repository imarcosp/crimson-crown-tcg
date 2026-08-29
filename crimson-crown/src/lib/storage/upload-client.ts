'use client'

import { createClient } from '@/lib/supabase/client'
import type { UploadTicket } from '@/lib/storage/upload-core'

export async function uploadWithTicket(
  file: File,
  ticket: UploadTicket,
): Promise<{ bucket: string; path: string }> {
  const supabase = createClient()
  const { data, error } = await supabase.storage
    .from(ticket.bucket)
    .uploadToSignedUrl(ticket.path, ticket.token, file, {
      contentType: file.type,
      upsert: false,
    })

  if (error || !data || data.path !== ticket.path) {
    throw new Error('No se pudo cargar el archivo.')
  }

  return Object.freeze({ bucket: ticket.bucket, path: ticket.path })
}
