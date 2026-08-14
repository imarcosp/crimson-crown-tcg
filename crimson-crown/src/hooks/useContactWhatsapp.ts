"use client"

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { siteConfig } from '@/config/site'
import { cleanSystemSettingValue, normalizeWhatsAppNumber } from '@/lib/contact-whatsapp'

export function useContactWhatsapp() {
  const [whatsapp, setWhatsapp] = useState(() => normalizeWhatsAppNumber(siteConfig.socialLinks.whatsapp))

  useEffect(() => {
    let mounted = true
    const supabase = createClient()

    const loadWhatsapp = async () => {
      const { data } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'contact_whatsapp')
        .maybeSingle()

      const normalized = normalizeWhatsAppNumber(cleanSystemSettingValue(data?.value || ''))
      if (mounted && normalized) setWhatsapp(normalized)
    }

    loadWhatsapp()

    return () => {
      mounted = false
    }
  }, [])

  return whatsapp
}
