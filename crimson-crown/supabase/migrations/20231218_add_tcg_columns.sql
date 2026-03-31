-- 1. Agregar columna 'metadata' a 'products' para guardar stats de otros TCGs (Might, Power, etc.)
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

-- 2. Asegurar que 'image_url' existe (si no se llama así, ajusta para crearla)
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS image_url text;

-- 3. Agregar columna para precios 'Etched' en la tabla de precios externos (Para Magic)
ALTER TABLE external_prices 
ADD COLUMN IF NOT EXISTS cardkingdom_retail_etched numeric;

-- 4. Agregar columna 'tcg' a 'products' si no existe (para diferenciar Magic de Riftbound)
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS tcg text DEFAULT 'Magic';

-- Comentario: Esta migración prepara la tabla para recibir datos de Riftbound y precios Etched.

