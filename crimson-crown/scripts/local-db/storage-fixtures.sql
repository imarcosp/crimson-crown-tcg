-- Sólo para el stack Supabase local de Crimson Crown.
-- No es una migración de producción: los buckets gestionados no forman parte
-- del dump SQL sanitizado y deben auditarse por separado antes de promover.

drop policy if exists "Local authenticated uploads payment proofs" on storage.objects;
create policy "Local authenticated uploads payment proofs"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'payment_proofs');

drop policy if exists "Local authenticated uploads import images" on storage.objects;
create policy "Local authenticated uploads import images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'products'
    and (storage.foldername(name))[1] = 'imports'
  );

drop policy if exists "Local admins manage product and banner objects" on storage.objects;
create policy "Local admins manage product and banner objects"
  on storage.objects for all to authenticated
  using (
    public.is_admin()
    and bucket_id in ('products', 'banners')
  )
  with check (
    public.is_admin()
    and bucket_id in ('products', 'banners')
  );

drop policy if exists "Local admins manage payment proof objects" on storage.objects;
create policy "Local admins manage payment proof objects"
  on storage.objects for all to authenticated
  using (public.is_admin() and bucket_id = 'payment_proofs')
  with check (public.is_admin() and bucket_id = 'payment_proofs');
