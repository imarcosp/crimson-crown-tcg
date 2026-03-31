import { resolve } from 'path';
import dotenv from 'dotenv';
import fs from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { createClient } from '@supabase/supabase-js';

// --- STREAM JSON IMPORTS ---
import streamChain from 'stream-chain';
const { chain } = streamChain;
import ParserPkg from 'stream-json/Parser.js';
const { parser } = ParserPkg;
import PickPkg from 'stream-json/filters/Pick.js';
const { pick } = PickPkg;
import StreamArrayPkg from 'stream-json/streamers/StreamArray.js';
const { streamArray } = StreamArrayPkg;

// 1. CONFIGURACIÓN DE ENTORNO (CRÍTICO: STAGING)
dotenv.config({ path: resolve(process.cwd(), '.env.staging'), override: true });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Error Fatal: No se encontraron las variables de entorno de Supabase en .env.staging');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Configuración
const SCRYFALL_BULK_URL = 'https://api.scryfall.com/bulk-data/default-cards';
const TEMP_FILE = './temp_scryfall_bulk.json';
const BATCH_SIZE = 1000;

// Helper: Extraer ID de CK de la URL
function extractCKId(url) {
    if (!url) return null;
    // Patrones comunes: 
    // .../mtg/set-name/card-name?partner=scryfall&utm_campaign=affiliate&utm_medium=scryfall&utm_source=scryfall
    // A veces NO hay ID numérico en la URL de 'purchase_uris', Scryfall usa un link de afiliado.
    // PERO: La especificación pide extraer ID numérico.
    // Si la URL es tipo: "https://mtgjson.com/links/ck/12345" (visto en MTGJSON), es fácil.
    // Si es tipo Scryfall directo: "https://www.cardkingdom.com/mtg/..." NO tiene ID numérico visible fácilmente.
    // Sin embargo, Scryfall a veces usa "https://www.cardkingdom.com/catalog/item/12345".
    
    // Vamos a intentar buscar patrones numéricos claros asociados a CK.
    // Si no encontramos ID numérico, no podemos guardar 'cardkingdom_id_normal' como entero/texto numérico.
    
    // NOTA: Scryfall en 'purchase_uris' suele dar URLs con slug, NO con ID.
    // Si el usuario pide extraer "el identificador único", y la URL es slug, 
    // asumiremos que la estrategia es intentar capturar '/item/(\d+)' o similar.
    
    const match = url.match(/\/item\/(\d+)/);
    if (match) return match[1];
    
    // Si no hay /item/, a veces hay parámetros 'id=...'
    const matchParam = url.match(/[?&]id=(\d+)/);
    if (matchParam) return matchParam[1];

    return null; 
}

async function main() {
    console.log('🚀 INICIANDO SINCRONIZACIÓN SCRYFALL -> SUPABASE (Extracción de IDs CK)');
    console.log(`🔗 Conectado a: ${SUPABASE_URL}`);

    // 2. OBTENER URL DE DESCARGA
    console.log('📡 Consultando API de Scryfall para obtener URI de descarga...');
    let downloadUri = '';
    try {
        const res = await fetch(SCRYFALL_BULK_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        const data = await res.json();
        downloadUri = data.download_uri;
        console.log(`✅ URI obtenida: ${downloadUri}`);
        console.log(`📦 Tamaño estimado: ${(data.size / 1024 / 1024).toFixed(2)} MB`);
    } catch (e) {
        console.error('❌ Error obteniendo URI de Scryfall:', e);
        process.exit(1);
    }

    // 3. DESCARGAR ARCHIVO (STREAMING)
    console.log('⬇️  Descargando archivo masivo (esto puede tardar)...');
    try {
        const response = await fetch(downloadUri);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(TEMP_FILE));
        console.log('✅ Descarga completada.');
    } catch (e) {
        console.error('❌ Error en la descarga:', e);
        process.exit(1);
    }

    // 4. PROCESAR STREAM Y UPSERT
    console.log('⚙️  Procesando JSON en streaming...');
    
    const pipelineStream = chain([
        fs.createReadStream(TEMP_FILE),
        parser(),
        streamArray(), // Scryfall devuelve un array raíz [...]
    ]);

    let batch = [];
    let totalProcessed = 0;
    let totalUpdated = 0;
    let ckIdsFound = 0;

    for await (const { value: card } of pipelineStream) {
        totalProcessed++;
        
        // Solo nos interesan cartas con ID de CK
        const ckUrl = card.purchase_uris?.cardkingdom;
        if (!ckUrl) continue;

        // Intentar extraer ID
        // NOTA IMPORTANTE: Muchos links de Scryfall son por SLUG, no por ID.
        // Si la URL es "https://www.cardkingdom.com/mtg/set/name", NO hay ID numérico.
        // Este script intentará extraerlo si existe.
        
        // Si el usuario quiere guardar la URL completa como ID alternativo, podría cambiar la lógica,
        // pero la instrucción dice "extraer el ID numérico".
        
        // Mapeo adicional: A veces Scryfall incluye 'cardmarket_id' o 'tcgplayer_id' como campos directos,
        // pero 'cardkingdom_id' NO suele venir directo, hay que mirar 'purchase_uris'.
        
        // Hack: Si la URL de compra redirige, no podemos saber el ID sin hacer fetch.
        // Pero intentemos ver si hay algo útil.
        
        // Si la URL contiene /mtg/, es un slug.
        // Si no podemos sacar ID numérico, saltamos (según instrucción estricta).
        const ckId = extractCKId(ckUrl);
        
        if (ckId) {
            ckIdsFound++;
            batch.push({
                scryfall_id: card.id,
                cardkingdom_id_normal: ckId,
                updated_at: new Date().toISOString()
            });
        }

        // Procesar lote
        if (batch.length >= BATCH_SIZE) {
            await processBatch(batch);
            totalUpdated += batch.length;
            batch = [];
            process.stdout.write(`\r   Procesados: ${totalProcessed} | IDs CK Encontrados: ${ckIdsFound} | Upserted: ${totalUpdated}`);
        }
    }

    // Último lote
    if (batch.length > 0) {
        await processBatch(batch);
        totalUpdated += batch.length;
    }

    console.log('\n\n==================================================');
    console.log('🎉 PROCESO FINALIZADO');
    console.log(`Total Cartas Scaneadas: ${totalProcessed}`);
    console.log(`IDs CK Encontrados:     ${ckIdsFound}`);
    console.log(`Registros Actualizados: ${totalUpdated}`);
    console.log('==================================================');

    // Limpieza
    if (fs.existsSync(TEMP_FILE)) fs.unlinkSync(TEMP_FILE);
}

async function processBatch(batch) {
    try {
        const { error } = await supabase
            .from('external_prices')
            .upsert(batch, { onConflict: 'scryfall_id', ignoreDuplicates: false });

        if (error) throw error;
    } catch (e) {
        console.error(`\n❌ Error en lote de ${batch.length} registros:`, e.message);
        // Retry granular simple
        console.log('   Reintentando uno a uno...');
        for (const item of batch) {
            try {
                await supabase.from('external_prices').upsert(item, { onConflict: 'scryfall_id' });
            } catch (err) {
                // Ignorar errores individuales para seguir
            }
        }
    }
}

main().catch(e => console.error('🔥 Error no controlado:', e));
