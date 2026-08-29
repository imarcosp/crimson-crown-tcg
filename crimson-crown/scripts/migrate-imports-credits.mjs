import 'dotenv/config'
import { createOperationalSupabaseClient as createClient } from './lib/guarded-supabase-client.mjs'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function main() {
    console.log('Por favor, ejecuta este SQL en tu Supabase SQL Editor para añadir soporte de pago con créditos en importaciones:');
    console.log(`
        ALTER TABLE import_orders ADD COLUMN IF NOT EXISTS credits_used NUMERIC(10,2) DEFAULT 0;
    `);
}

main()
