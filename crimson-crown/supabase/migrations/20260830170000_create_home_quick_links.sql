create table if not exists public.home_quick_links (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  url text not null,
  image_url text,
  icon_key text not null default 'sparkles',
  display_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint home_quick_links_label_check check (
    char_length(btrim(label)) between 1 and 80
  ),
  constraint home_quick_links_url_check check (
    char_length(btrim(url)) between 1 and 500
  ),
  constraint home_quick_links_image_url_check check (
    image_url is null or char_length(btrim(image_url)) between 1 and 500
  ),
  constraint home_quick_links_icon_key_check check (
    icon_key in ('sparkles', 'crown', 'package', 'shopping-bag', 'search', 'tag', 'heart', 'truck')
  ),
  constraint home_quick_links_display_order_check check (
    display_order between 0 and 9999
  )
);

create index if not exists home_quick_links_public_order_idx
  on public.home_quick_links (display_order, created_at, id)
  where active = true;

alter table public.home_quick_links enable row level security;

revoke all on table public.home_quick_links from public, anon, authenticated;
grant select on table public.home_quick_links to anon, authenticated;
grant insert, update, delete on table public.home_quick_links to authenticated;

drop policy if exists "Public read active home quick links" on public.home_quick_links;
create policy "Public read active home quick links" on public.home_quick_links
  for select to anon, authenticated
  using (active = true);

drop policy if exists "Admins manage home quick links" on public.home_quick_links;
create policy "Admins manage home quick links" on public.home_quick_links
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

comment on table public.home_quick_links is
  'Accesos promocionales administrables que se muestran debajo del banner de Home.';
