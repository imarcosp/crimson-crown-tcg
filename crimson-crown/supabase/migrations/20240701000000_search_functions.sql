-- Habilitar extensión unaccent si no existe
create extension if not exists unaccent;

-- Función helper para normalizar texto (lowercase + unaccent)
create or replace function normalize_text(t text) returns text as $$
begin
  return lower(unaccent(t));
end;
$$ language plpgsql immutable;

-- -----------------------------------------------------------------------------
-- Búsqueda avanzada de Órdenes (V2)
-- -----------------------------------------------------------------------------
create or replace function search_orders_v2(
  search_term text,
  status_filter text default null,
  hide_completed boolean default false,
  limit_val int default 20,
  offset_val int default 0
)
returns table (
  id uuid,
  created_at timestamptz,
  total_amount numeric,
  status text,
  tracking_number text,
  delivery_notes text,
  user_id uuid,
  credits_used numeric,
  is_packed boolean,
  payment_proof_url text,
  contact_name text,
  contact_lastname text,
  email text,
  full_count bigint
) as $$
declare
  norm_term text;
begin
  norm_term := normalize_text(search_term);

  return query
  with filtered_orders as (
    select 
      o.*,
      p.email as user_email
    from orders o
    left join profiles p on o.user_id = p.id
    where 
      -- Filtro de Estado
      (status_filter is null or o.status = status_filter)
      and
      -- Filtro Ocultar Completadas
      (not hide_completed or o.status not in ('completed', 'refunded', 'cancelled'))
      and
      -- Búsqueda por Texto
      (
        search_term is null or search_term = '' or
        normalize_text(o.id::text) like '%' || norm_term || '%' or
        normalize_text(o.tracking_number) like '%' || norm_term || '%' or
        normalize_text(o.contact_name) like '%' || norm_term || '%' or
        normalize_text(o.contact_lastname) like '%' || norm_term || '%' or
        normalize_text(p.email) like '%' || norm_term || '%' or
        -- Búsqueda en Items (Productos)
        exists (
          select 1 from order_items oi
          join products prod on oi.product_id = prod.id
          where oi.order_id = o.id
          and normalize_text(prod.name) like '%' || norm_term || '%'
        )
      )
  ),
  total_count as (
    select count(*) as cnt from filtered_orders
  )
  select 
    fo.id,
    fo.created_at,
    fo.total_amount,
    fo.status,
    fo.tracking_number,
    fo.delivery_notes,
    fo.user_id,
    fo.credits_used,
    fo.is_packed,
    fo.payment_proof_url,
    fo.contact_name,
    fo.contact_lastname,
    fo.user_email,
    tc.cnt
  from filtered_orders fo
  cross join total_count tc
  order by fo.created_at desc
  limit limit_val offset offset_val;
end;
$$ language plpgsql;

-- -----------------------------------------------------------------------------
-- Búsqueda avanzada de Importaciones (V2)
-- -----------------------------------------------------------------------------
create or replace function search_imports_v2(
  search_term text,
  hide_finished boolean default false,
  date_from text default null,
  date_to text default null,
  limit_val int default 20,
  offset_val int default 0
)
returns table (
  id uuid,
  created_at timestamptz,
  order_number text,
  status text,
  payment_status text,
  user_id uuid,
  payment_proof_url text,
  shipping_address jsonb,
  notes text,
  first_name text,
  last_name text,
  email text,
  items jsonb,
  full_count bigint
) as $$
declare
  norm_term text;
begin
  norm_term := normalize_text(search_term);

  return query
  with filtered_imports as (
    select 
      io.*,
      p.first_name,
      p.last_name,
      p.email,
      (
        select jsonb_agg(jsonb_build_object(
          'id', ii.id,
          'product_name', ii.product_name,
          'quantity', ii.quantity,
          'unit_price', ii.unit_price,
          'tax_percent', ii.tax_percent,
          'shipping_cost', ii.shipping_cost
        ))
        from import_items ii
        where ii.order_id = io.id
      ) as items_json
    from import_orders io
    left join profiles p on io.user_id = p.id
    where 
      -- Filtro Ocultar Finalizadas
      (not hide_finished or io.status not in ('Disponible', 'Completada', 'Solo Cotización'))
      and
      -- Filtro Fechas
      (date_from is null or io.created_at >= date_from::timestamptz)
      and
      (date_to is null or io.created_at <= (date_to || ' 23:59:59')::timestamptz)
      and
      -- Búsqueda por Texto
      (
        search_term is null or search_term = '' or
        normalize_text(io.order_number) like '%' || norm_term || '%' or
        normalize_text(p.first_name) like '%' || norm_term || '%' or
        normalize_text(p.last_name) like '%' || norm_term || '%' or
        normalize_text(p.email) like '%' || norm_term || '%' or
        -- Búsqueda en Items (Productos Importados)
        exists (
          select 1 from import_items ii
          where ii.order_id = io.id
          and normalize_text(ii.product_name) like '%' || norm_term || '%'
        )
      )
  ),
  total_count as (
    select count(*) as cnt from filtered_imports
  )
  select 
    fi.id,
    fi.created_at,
    fi.order_number,
    fi.status,
    fi.payment_status,
    fi.user_id,
    fi.payment_proof_url,
    fi.shipping_address,
    fi.notes,
    fi.first_name,
    fi.last_name,
    fi.email,
    fi.items_json,
    tc.cnt
  from filtered_imports fi
  cross join total_count tc
  order by fi.created_at desc
  limit limit_val offset offset_val;
end;
$$ language plpgsql;
