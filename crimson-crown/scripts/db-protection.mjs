import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function main() {
    console.log('--- PROTECCIÓN DE BASE DE DATOS CONTRA STOCK NEGATIVO Y DOBLE COBRO ---');
    console.log('Por favor, ejecuta estas consultas en el SQL Editor de tu panel de Supabase:');
    
    console.log(`
/* 1. Evitar que el stock sea negativo */
ALTER TABLE products ADD CONSTRAINT stock_non_negative CHECK (stock >= 0);

/* 2. Evitar que los créditos del usuario sean negativos */
ALTER TABLE profiles ADD CONSTRAINT credits_non_negative CHECK (credits >= 0);

/* NOTA: Si alguna de estas tablas ya tiene números negativos, el comando fallará.
   Debes corregir los números negativos manualmente antes de ejecutar esto. */
    `);
}

main()
