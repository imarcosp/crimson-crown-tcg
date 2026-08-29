'use server'

import { isAdminEmail } from '@/lib/auth/admin-access'
import { COMMISSION_START_PERIOD_KEY } from '@/lib/commissions'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createServerClient } from '@/lib/supabase/server'
import {
  createUploadTicketCore,
  type CreateUploadTicketDependencies,
  type CreateUploadTicketInput,
  type RecordAccessRequest,
  type UploadActor,
  type UploadTicket,
} from '@/lib/storage/upload-core'
import type { UploadKind } from '@/lib/storage/upload-policy'

const CREATE_ERROR_MESSAGE = 'No se pudo autorizar la carga.'

function parseUploadInput(rawInput: unknown): CreateUploadTicketInput {
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    throw new Error(CREATE_ERROR_MESSAGE)
  }

  const input = rawInput as Record<string, unknown>
  if (
    typeof input.kind !== 'string' ||
    typeof input.name !== 'string' ||
    typeof input.size !== 'number' ||
    typeof input.mimeType !== 'string' ||
    (input.recordId !== undefined && typeof input.recordId !== 'string') ||
    (input.inventoryId !== undefined && typeof input.inventoryId !== 'string')
  ) {
    throw new Error(CREATE_ERROR_MESSAGE)
  }

  return Object.freeze({
    kind: input.kind as UploadKind,
    name: input.name,
    size: input.size,
    mimeType: input.mimeType,
    recordId: input.recordId as string | undefined,
    inventoryId: input.inventoryId as string | undefined,
  })
}

async function getUploadActor(): Promise<UploadActor | null> {
  const supabase = await createServerClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) return null

  const email = user.email ?? null
  const isAdmin = isAdminEmail(email)
  return Object.freeze({
    userId: user.id,
    email,
    isAdmin,
    isCommissionAdmin: isAdmin,
  })
}

async function assertRecordAccess(request: RecordAccessRequest): Promise<void> {
  const admin = createAdminClient()

  switch (request.kind) {
    case 'admin-product-image': {
      const { data, error } = await admin
        .from('inventories')
        .select('id')
        .eq('id', request.recordId)
        .eq('is_active', true)
        .is('archived_at', null)
        .maybeSingle()
      if (error || !data) throw new Error(CREATE_ERROR_MESSAGE)
      return
    }
    case 'order-proof': {
      const { data, error } = await admin
        .from('orders')
        .select('user_id, status')
        .eq('id', request.recordId)
        .maybeSingle()
      if (
        error ||
        !data ||
        data.user_id !== request.actor.userId ||
        !['pending_payment', 'verifying_payment'].includes(String(data.status))
      ) {
        throw new Error(CREATE_ERROR_MESSAGE)
      }
      return
    }
    case 'import-proof': {
      const { data, error } = await admin
        .from('import_orders')
        .select('user_id, status')
        .eq('id', request.recordId)
        .maybeSingle()
      if (
        error ||
        !data ||
        data.user_id !== request.actor.userId ||
        data.status !== 'Cotizada'
      ) {
        throw new Error(CREATE_ERROR_MESSAGE)
      }
      return
    }
    case 'commission-proof': {
      const { data, error } = await admin
        .from('commission_periods')
        .select('period_key')
        .eq('id', request.recordId)
        .maybeSingle()
      if (
        error ||
        !data ||
        typeof data.period_key !== 'string' ||
        data.period_key < COMMISSION_START_PERIOD_KEY
      ) {
        throw new Error(CREATE_ERROR_MESSAGE)
      }
    }
  }
}

function createDependencies(): CreateUploadTicketDependencies {
  return {
    randomUUID: () => crypto.randomUUID(),
    getActor: getUploadActor,
    assertRecordAccess,
    createSignedUploadUrl: async (bucket, path, options) => {
      const admin = createAdminClient()
      const { data, error } = await admin.storage
        .from(bucket)
        .createSignedUploadUrl(path, options)

      if (error || !data) throw new Error(CREATE_ERROR_MESSAGE)
      return { token: data.token, path: data.path }
    },
  }
}

export async function createUploadTicketAction(input: unknown): Promise<UploadTicket> {
  try {
    return await createUploadTicketCore(parseUploadInput(input), createDependencies())
  } catch {
    throw new Error(CREATE_ERROR_MESSAGE)
  }
}
