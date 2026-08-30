-- Sólo para el stack Supabase local de Crimson Crown.
-- No es una migración de producción: los buckets gestionados no forman parte
-- del dump SQL sanitizado y deben auditarse por separado antes de promover.

drop policy if exists "Local authenticated uploads payment proofs" on storage.objects;
drop policy if exists "Local authenticated uploads import images" on storage.objects;
drop policy if exists "Local admins manage product and banner objects" on storage.objects;
drop policy if exists "Local admins manage payment proof objects" on storage.objects;

-- No se crean políticas INSERT/UPDATE/DELETE para el navegador. El service role
-- sólo entrega tickets firmados de ruta exacta desde las acciones del servidor.
