import { resolve } from 'path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// 1. CONFIGURACIÓN INICIAL
dotenv.config({ path: resolve(process.cwd(), '.env.local'), override: true });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Error Fatal: No se encontraron las variables de entorno de Supabase en .env.local');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const CK_API_URL = 'https://api.cardkingdom.com/api/v2/pricelist';

async function main() {
    console.log('🚀 INICIANDO SYNC PRECIOS CK (V5: SCRYFALL ID DRIVEN)');
    console.log(`🔗 Conectado a: ${SUPABASE_URL}`);
    const startTime = Date.now();

    // 1. LEER ESTADO ACTUAL (Para comparar)
    console.log('\n📥 Leyendo estado actual de external_prices...');
    const { data: currentData, error } = await supabase
        .from('external_prices')
        .select('scryfall_id, cardkingdom_id_normal, cardkingdom_id_foil, cardkingdom_retail_normal, cardkingdom_retail_foil, tcgplayer_market_normal, tcgplayer_market_foil');
    
    if (error) { console.error('Error leyendo BD:', error); process.exit(1); }
    
    const currentMap = new Map();
    currentData.forEach(row => currentMap.set(row.scryfall_id, row));
    console.log(`✅ ${currentMap.size} registros actuales en memoria.`);

    // 2. DESCARGAR API CK Y CREAR ÍNDICES
    console.log('\n⬇️  Descargando API CardKingdom...');
    let ckData = [];
    try {
        const res = await fetch(CK_API_URL);
        const json = await res.json();
        ckData = json.data || (Array.isArray(json) ? json : []);
    } catch (e) {
        console.error('❌ Error descargando CK:', e);
        process.exit(1);
    }
    console.log(`✅ ${ckData.length} items descargados.`);

    // Crear Índices en Memoria
    console.log('⚙️  Indexando datos de CK...');
    const ckByScryfall = new Map();
    const ckById = new Map();

    for (const item of ckData) {
        const ckId = String(item.id);
        
        // Índice por ID (Para buscar por ID curado)
        ckById.set(ckId, item);

        // Índice por Scryfall (Para match automático)
        if (item.scryfall_id && item.scryfall_id.length === 36) {
            // Guardamos array porque puede haber foil y non-foil con mismo scryfall_id
            if (!ckByScryfall.has(item.scryfall_id)) ckByScryfall.set(item.scryfall_id, []);
            ckByScryfall.get(item.scryfall_id).push(item);
        }
    }

    // 3. PROCESAR EXTERNAL PRICES (LA VERDAD ESTÁ EN LA BD)
    // En lugar de iterar CK, iteramos nuestra BD para respetar curaciones
    // PERO: Si iteramos solo la BD, no agregamos cartas nuevas que CK haya añadido hoy.
    // ESTRATEGIA HÍBRIDA:
    // 1. Usar un Set de todos los scryfall_ids conocidos (BD + CK).
    // 2. Iterar ese Set.
    
    console.log('⚙️  Calculando universo de cartas...');
    const allScryfallIds = new Set(currentMap.keys());
    for (const sId of ckByScryfall.keys()) {
        allScryfallIds.add(sId);
    }
    console.log(`   Universo total: ${allScryfallIds.size} Scryfall IDs.`);

    const updates = new Map(); 
    let stats = {
        idsAdded: 0,
        idsChanged: 0,
        pricesUpdated: 0,
        manualMatches: 0 // Matches por CK ID existente
    };

    for (const sId of allScryfallIds) {
        const current = currentMap.get(sId) || {};
        
        // Objeto de actualización base
        const entry = {
            scryfall_id: sId,
            updated_at: new Date().toISOString()
        };
        let hasChanges = false;

        // --- LÓGICA DE MATCHING ---
        
        // 1. Intentar match automático por Scryfall ID
        const autoMatches = ckByScryfall.get(sId) || [];
        let matchNormal = autoMatches.find(i => String(i.is_foil) !== 'true');
        let matchFoil = autoMatches.find(i => String(i.is_foil) === 'true');

        // 2. Si no hay match automático, intentar match por ID curado (Fallback)
        if (!matchNormal && current.cardkingdom_id_normal) {
            const found = ckById.get(current.cardkingdom_id_normal);
            if (found) {
                matchNormal = found;
                stats.manualMatches++;
            }
        }
        if (!matchFoil && current.cardkingdom_id_foil) {
            const found = ckById.get(current.cardkingdom_id_foil);
            if (found) {
                matchFoil = found;
                stats.manualMatches++;
            }
        }

        // --- PROCESAMIENTO DE DATOS ---

        // NORMAL
        if (matchNormal) {
            const ckId = String(matchNormal.id);
            const sell = parseFloat(matchNormal.price_retail || matchNormal.sell_price || 0);
            const buy = parseFloat(matchNormal.price_buy || matchNormal.buy_price || 0);

            // ID Update
            if (current.cardkingdom_id_normal !== ckId) {
                entry.cardkingdom_id_normal = ckId;
                hasChanges = true;
                if (!current.cardkingdom_id_normal) stats.idsAdded++;
                else stats.idsChanged++;
            }

            // Price Update
            if (sell > 0 && current.cardkingdom_retail_normal !== sell) {
                entry.cardkingdom_retail_normal = sell;
                hasChanges = true;
                stats.pricesUpdated++;
            }
            if (buy > 0) { entry.cardkingdom_buylist_normal = buy; hasChanges = true; }
            
            // Variation
            if (matchNormal.variation) {
                entry.cardkingdom_variation = matchNormal.variation;
                hasChanges = true;
            }
        }

        // FOIL
        if (matchFoil) {
            const ckId = String(matchFoil.id);
            const sell = parseFloat(matchFoil.price_retail || matchFoil.sell_price || 0);
            const buy = parseFloat(matchFoil.price_buy || matchFoil.buy_price || 0);

            // ID Update
            if (current.cardkingdom_id_foil !== ckId) {
                entry.cardkingdom_id_foil = ckId;
                hasChanges = true;
                if (!current.cardkingdom_id_foil) stats.idsAdded++;
                else stats.idsChanged++;
            }

            // Price Update
            if (sell > 0 && current.cardkingdom_retail_foil !== sell) {
                entry.cardkingdom_retail_foil = sell;
                hasChanges = true;
                stats.pricesUpdated++;
            }
            if (buy > 0) { entry.cardkingdom_buylist_foil = buy; hasChanges = true; }

            // Variation (Concatenar si ya existe)
            if (matchFoil.variation) {
                const v = `Foil ${matchFoil.variation}`;
                entry.cardkingdom_variation = entry.cardkingdom_variation ? `${entry.cardkingdom_variation}, ${v}` : v;
                hasChanges = true;
            }
        }

        // Solo agregar a updates si hubo cambios reales O es un registro nuevo
        if (hasChanges || !currentMap.has(sId)) {
            updates.set(sId, entry);
        }
    }

    console.log(`\n📊 REPORTE DE CAMBIOS:`);
    console.log(`   - IDs Agregados: ${stats.idsAdded}`);
    console.log(`   - IDs Corregidos: ${stats.idsChanged}`);
    console.log(`   - Precios Actualizados: ${stats.pricesUpdated}`);
    console.log(`   - Matches por ID Curado (TMNT/Otros): ${stats.manualMatches}`);
    console.log(`   - Total a Upsert: ${updates.size}`);

    // 4. UPSERT MASIVO EXTERNAL PRICES
    console.log(`\n💾 Guardando cambios en 'external_prices'...`);
    const batchList = Array.from(updates.values());
    await batchUpsert(batchList, 'external_prices');

    // 5. PROPAGACIÓN A PRODUCTS (INVENTARIO)
    console.log('\n🔄 PROPAGANDO PRECIOS A INVENTARIO (Tabla products)...');
    
    // Descargar productos locales (Paginado)
    let localProducts = [];
    let page = 0;
    const PAGE_SIZE = 5000; // Traer bastantes para ir rápido
    let hasMore = true;

    console.log('   Descargando inventario...');
    while (hasMore) {
        const { data, error } = await supabase
            .from('products')
            .select('id, inventory_id, name, finish, condition, scryfall_id, price_usd, is_manual_price')
            .eq('tcg', 'Magic')
            .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
        
        if (error) { console.error('Error fetching products:', error); break; }
        
        if (data.length > 0) {
            localProducts = localProducts.concat(data);
            page++;
            process.stdout.write(`\r   Cargados: ${localProducts.length}...`);
        } else {
            hasMore = false;
        }
    }
    console.log(`\n   ✅ Inventario cargado. Analizando ${localProducts.length} items.`);

    let productsUpdated = 0;
    let productsSkippedManual = 0;
    let productsSkippedNoPrice = 0;
    const productUpdates = [];

    // Lógica de Precios
    for (const p of localProducts) {
        // Respetar precio manual
        if (p.is_manual_price) {
            productsSkippedManual++;
            continue;
        }

        const scryId = p.scryfall_id;
        if (!scryId) continue;

        // Buscar precio en nuestra memoria (updates map tiene lo último de CK)
        // OJO: updates solo tiene lo que vino de CK HOY. 
        // Si CK no trajo la carta hoy (raro), no estará en updates.
        // Deberíamos hacer un fallback a leer de external_prices si no está en updates?
        // Dado que bajamos TODO CK, si no está en updates es que CK no lo tiene.
        // Pero podría estar en external_prices de una carga anterior (TCGPlayer fallback).
        // Para ser seguros, usaremos 'updates' primero, y si no, asumimos que el precio no cambió o usamos el viejo.
        // MEJORA: Para simplificar, usaremos 'updates' como fuente de verdad fresca.
        
        // Combinar el update de hoy con el registro persistido para conservar
        // TCGplayer cuando Card Kingdom no tiene precio para la variante.
        const extData = { ...(current || {}), ...(updates.get(scryId) || {}) };
        if (!currentMap.has(scryId) && !updates.has(scryId)) {
            productsSkippedNoPrice++;
            continue;
        }

        // Determinar variante
        const f = String(p.finish || '').toLowerCase();
        const isFoil = (f.includes('foil') && !f.includes('non')) || f.includes('etched') || f.includes('halo') || f.includes('surge');
        
        let basePrice = 0;
        if (isFoil) {
            const cardKingdomPrice = Number(extData.cardkingdom_retail_foil || 0);
            const tcgPlayerPrice = Number(extData.tcgplayer_market_foil || 0);
            basePrice = cardKingdomPrice > 0 ? cardKingdomPrice : tcgPlayerPrice;
        } else {
            const cardKingdomPrice = Number(extData.cardkingdom_retail_normal || 0);
            const tcgPlayerPrice = Number(extData.tcgplayer_market_normal || 0);
            basePrice = cardKingdomPrice > 0 ? cardKingdomPrice : tcgPlayerPrice;
        }

        if (basePrice <= 0) {
            productsSkippedNoPrice++;
            continue;
        }

        // Multiplicador Condición
        const cond = (p.condition || 'NM').toUpperCase();
        let multiplier = 1.0;
        if (cond === 'PL' || cond === 'SP') multiplier = 0.85;
        if (cond === 'HP' || cond === 'MP') multiplier = 0.75;
        if (cond === 'DMG') multiplier = 0.50;

        let finalPrice = basePrice * multiplier;
        
        // Regla de Mínimo ($0.35)
        if (finalPrice < 0.35) finalPrice = 0.35;

        // Verificar cambio significativo
        if (Math.abs(finalPrice - Number(p.price_usd || 0)) > 0.01) {
            productUpdates.push({
                id: p.id,
                inventory_id: p.inventory_id,
                price_usd: finalPrice
                // updated_at: new Date().toISOString() // Quitamos esto porque la columna no existe en products
            });
        }
    }

    console.log(`   Calculados ${productUpdates.length} cambios de precio.`);

    // Aplicar cambios a products (Uno a uno para evitar problemas de constraints en upsert parcial)
    if (productUpdates.length > 0) {
        console.log(`   Aplicando actualizaciones a products (Secuencial)...`);
        let saved = 0;
        
        for (const p of productUpdates) {
            const { error } = await supabase
                .from('products')
                .update({ price_usd: p.price_usd })
                .eq('id', p.id)
                .eq('inventory_id', p.inventory_id)
                .eq('is_manual_price', false);
            
            if (error) {
                console.error(`   Error actualizando producto ${p.id}:`, error.message);
            } else {
                saved++;
            }
            if (saved % 50 === 0) process.stdout.write(`\r   Actualizados: ${saved} / ${productUpdates.length}`);
        }
        productsUpdated = saved;
        console.log('\n');
    }

    // ALERTA DE PRECIOS CERO
    const zeroPrices = localProducts.filter(p => !p.is_manual_price && p.price_usd <= 0);
    if (zeroPrices.length > 0) {
        console.warn(`\n⚠️  ALERTA: ${zeroPrices.length} productos tienen PRECIO CERO (No se encontró referencia):`);
        zeroPrices.slice(0, 10).forEach(p => console.warn(`   - [${p.scryfall_id}] ${p.name} (${p.finish})`));
        if (zeroPrices.length > 10) console.warn(`   ... y ${zeroPrices.length - 10} más.`);
    }

    console.log('\n==================================================');
    console.log(`🎉 SINCRONIZACIÓN V5 + PROPAGACIÓN COMPLETADA`);
    console.log(`⏱️  Duración: ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
    console.log('==================================================');
    console.log(`📊 EXTERNAL PRICES (CK):`);
    // console.log(`   - Procesados: ${matchedCount}`); // Variable eliminada
    console.log(`   - Nuevos/Upserted: ${updates.size}`);
    console.log(`📊 INVENTARIO LOCAL (Products):`);
    console.log(`   - Precios Actualizados: ${productsUpdated}`);
    console.log(`   - Manuales (Intactos): ${productsSkippedManual}`);
    console.log(`   - Sin Precio Referencia: ${productsSkippedNoPrice}`);
    console.log('==================================================');
}

// Función Genérica de Upsert por Lotes
async function batchUpsert(data, table) {
    const BATCH_SIZE = 1000;
    let processed = 0;

    for (let i = 0; i < data.length; i += BATCH_SIZE) {
        const batch = data.slice(i, i + BATCH_SIZE);
        try {
            const { error } = await supabase.from(table).upsert(batch, { onConflict: 'scryfall_id' });
            if (error) throw error;
            processed += batch.length;
            process.stdout.write(`\r   Progreso: ${processed} / ${data.length}`);
        } catch (e) {
            console.log(`\n⚠️ Fallo en bloque ${i} (${e.message}). Reintentando uno a uno...`);
            // Retry simple
            for (const item of batch) {
                try {
                    await supabase.from(table).upsert(item, { onConflict: 'scryfall_id' });
                } catch (err) {}
            }
        }
    }
    console.log('\n   ✅ Batch finalizado.');
}

main().catch(console.error);
