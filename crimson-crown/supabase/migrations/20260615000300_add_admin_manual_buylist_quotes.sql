alter table public.buylist_orders
  add column if not exists created_by_admin_id uuid references public.profiles(id),
  add column if not exists sent_at timestamptz;

comment on column public.buylist_orders.created_by_admin_id is
  'Si tiene valor, la cotizacion fue creada manualmente por un admin.';

comment on column public.buylist_orders.sent_at is
  'Fecha en la que una cotizacion manual fue enviada al usuario.';
