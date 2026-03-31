import * as cheerio from 'cheerio';

export async function fetchDolarCripto(): Promise<number | null> {
  try {
    console.log("🔄 Scrapeando DolarHoy con lógica mejorada...");
    // Headers para simular navegador real y evitar bloqueos simples
    const response = await fetch(' https://dolarhoy.com/ ', {
      next: { revalidate: 0 },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    
    const html = await response.text();
    const $ = cheerio.load(html);

    let ventaPrice = 0;

    // ESTRATEGIA: Iterar sobre todas las tarjetas (.tile)
    $('.tile').each((index, element) => {
      const title = $(element).find('.title').text().trim();
      
      // Buscamos específicamente el bloque que dice "Cripto"
      if (title.includes('Cripto') || title.includes('cripto')) {
        console.log(`🔎 Encontrado bloque Cripto: ${title}`);
        
        // Dentro de este bloque, buscamos los valores
        // Usualmente hay dos valores: Compra y Venta.
        // La estructura suele ser: .compra .val / .venta .val
        
        const ventaBlock = $(element).find('.venta').find('.val').text();
        console.log(`   Valor crudo encontrado: ${ventaBlock}`);
        
        // Limpiamos el texto: "$ 1.503,89" -> "1503.89"
        const clean = ventaBlock 
          .replace('$', '') 
          .replace('venta', '') // A veces el texto se pega 
          .replace(/\./g, '')   // Quitar punto de miles 
          .replace(',', '.')    // Cambiar coma decimal por punto 
          .trim();
          
        ventaPrice = parseFloat(clean);
      }
    });

    if (!ventaPrice || isNaN(ventaPrice)) {
      console.error("❌ No se pudo extraer el precio Cripto Venta.");
      return null;
    }

    console.log(`✅ Precio final detectado: ${ventaPrice}`);
    return ventaPrice;

  } catch (error) {
    console.error("Error scraping dolar:", error);
    return null;
  }
}
