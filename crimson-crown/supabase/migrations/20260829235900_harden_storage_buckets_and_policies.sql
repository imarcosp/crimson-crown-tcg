begin;

-- Rollback operacional compatible: restaurar únicamente los flags y policies
-- exactos del checkpoint anterior. Este forward no borra objetos, filas ni datos,
-- y un rollback tampoco debe eliminar buckets ni contenido histórico.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values
  (
    'products',
    'products',
    true,
    5242880,
    array['image/jpeg', 'image/png', 'image/webp']::text[]
  ),
  (
    'banners',
    'banners',
    true,
    5242880,
    array['image/jpeg', 'image/png', 'image/webp']::text[]
  ),
  (
    'payment_proofs',
    'payment_proofs',
    false,
    5242880,
    array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[]
  )
on conflict (id) do update set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Give users access to own folder 1ifhysk_0" on storage.objects;
drop policy if exists "Give users access to own folder 1ifhysk_1" on storage.objects;
drop policy if exists "Give users access to own folder 1ifhysk_2" on storage.objects;
drop policy if exists "Give users access to own folder 1ifhysk_3" on storage.objects;
drop policy if exists "Give users authenticated access to folder 1ifhysk_0" on storage.objects;
drop policy if exists "Give users authenticated access to folder 1ifhysk_1" on storage.objects;
drop policy if exists "Give users authenticated access to folder 1ifhysk_2" on storage.objects;
drop policy if exists "Give users authenticated access to folder 1ifhysk_3" on storage.objects;
drop policy if exists "Lectura pública de comprobantes" on storage.objects;
drop policy if exists "Usuarios pueden subir comprobantes" on storage.objects;
drop policy if exists "Admin gestiona banners" on storage.objects;
drop policy if exists "Cualquiera ve banners" on storage.objects;

drop policy if exists "Local authenticated uploads payment proofs" on storage.objects;
drop policy if exists "Local authenticated uploads import images" on storage.objects;
drop policy if exists "Local admins manage product and banner objects" on storage.objects;
drop policy if exists "Local admins manage payment proof objects" on storage.objects;

commit;
