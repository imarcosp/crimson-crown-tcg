BEGIN;

SET LOCAL statement_timeout = '2min';
SET LOCAL lock_timeout = '10s';

-- Keep UUIDs and catalog relationships stable while replacing customer identity data.
UPDATE public.profiles
SET email = 'test.user.' || left(replace(id::text, '-', ''), 12) || '@example.test',
    first_name = 'Test',
    last_name = 'User ' || left(replace(id::text, '-', ''), 8),
    full_name = 'Test User ' || left(replace(id::text, '-', ''), 8),
    phone = '+549110000' || right(regexp_replace(md5(id::text), '[^0-9]', '', 'g') || '000000', 6),
    avatar_url = NULL;

UPDATE public.orders
SET tracking_number = CASE
      WHEN tracking_number IS NULL THEN NULL
      ELSE 'TEST-TRACK-' || left(replace(id::text, '-', ''), 12)
    END,
    delivery_notes = CASE
      WHEN delivery_notes IS NULL THEN NULL
      ELSE 'Local test delivery note'
    END,
    shipping_address = CASE
      WHEN shipping_address IS NULL THEN NULL
      ELSE jsonb_build_object(
        'street', 'Test Street 100',
        'city', 'Test City',
        'postal_code', '0000',
        'country', 'AR'
      )
    END,
    contact_name = CASE WHEN contact_name IS NULL THEN NULL ELSE 'Test' END,
    contact_lastname = CASE WHEN contact_lastname IS NULL THEN NULL ELSE 'Customer' END,
    contact_phone = CASE WHEN contact_phone IS NULL THEN NULL ELSE '+5491100000000' END,
    payment_proof_url = NULL;

UPDATE public.import_orders
SET order_number = 'TEST-IMPORT-' || id::text,
    admin_notes = CASE WHEN admin_notes IS NULL THEN NULL ELSE 'Local test admin note' END,
    payment_proof_url = NULL,
    user_notes = CASE WHEN user_notes IS NULL THEN NULL ELSE 'Local test user note' END;

UPDATE public.buylist_orders
SET admin_notes = CASE WHEN admin_notes IS NULL THEN NULL ELSE 'Local test admin note' END;

UPDATE public.buylist_items
SET notes = CASE WHEN notes IS NULL THEN NULL ELSE 'Local test item note' END;

UPDATE public.commission_adjustments
SET reason = CASE WHEN reason IS NULL THEN NULL ELSE 'Local test adjustment' END,
    notes = CASE WHEN notes IS NULL THEN NULL ELSE 'Local test adjustment note' END;

UPDATE public.commission_payments
SET reference = CASE WHEN reference IS NULL THEN NULL ELSE 'LOCAL-TEST-REFERENCE' END,
    notes = CASE WHEN notes IS NULL THEN NULL ELSE 'Local test payment note' END,
    proof_url = NULL,
    rejection_reason = CASE
      WHEN rejection_reason IS NULL THEN NULL
      ELSE 'Local test rejection reason'
    END;

UPDATE public.commission_periods
SET notes = CASE WHEN notes IS NULL THEN NULL ELSE 'Local test commission note' END;

UPDATE public.commission_period_lines
SET metadata = CASE
  WHEN metadata IS NULL THEN NULL
  ELSE jsonb_build_object('source', 'local-test-fixture')
END;

UPDATE public.feedback
SET comment = CASE WHEN comment IS NULL THEN NULL ELSE 'Local test feedback' END,
    page_url = CASE WHEN page_url IS NULL THEN NULL ELSE '/local-test' END;

UPDATE public.notifications
SET title = CASE WHEN title IS NULL THEN NULL ELSE 'Local test notification' END,
    message = CASE WHEN message IS NULL THEN NULL ELSE 'Local test message' END,
    link = CASE WHEN link IS NULL THEN NULL ELSE '/local-test' END;

UPDATE public.search_logs
SET query = 'local test query';

UPDATE public.system_settings
SET value = CASE key
  WHEN 'contact_address' THEN to_jsonb('Local test address'::text)
  WHEN 'contact_address_note' THEN to_jsonb('Local test address note'::text)
  WHEN 'contact_email' THEN to_jsonb('contact@example.test'::text)
  WHEN 'contact_instagram' THEN to_jsonb('@crimsoncrown_local_test'::text)
  WHEN 'contact_schedule' THEN to_jsonb('Mon-Fri 10:00-18:00 (local test)'::text)
  WHEN 'contact_whatsapp' THEN to_jsonb('+5491100000000'::text)
  WHEN 'how_to_content' THEN to_jsonb('Local test instructions'::text)
  WHEN 'import_warning_text' THEN to_jsonb('Local test import warning'::text)
  WHEN 'store_description' THEN to_jsonb('Crimson Crown local test store'::text)
  ELSE value
END
WHERE key IN (
  'contact_address',
  'contact_address_note',
  'contact_email',
  'contact_instagram',
  'contact_schedule',
  'contact_whatsapp',
  'how_to_content',
  'import_warning_text',
  'store_description'
);

-- Production URLs in promotional links must never be followed by local tests.
UPDATE public.banners
SET link_url = CASE WHEN link_url IS NULL THEN NULL ELSE '/local-test' END;

COMMIT;
