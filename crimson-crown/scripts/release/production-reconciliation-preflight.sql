-- Read-only, aggregate-only production proof for the Crimson reconciliation release.
-- The result contains catalog hashes and row hashes, never business-row payloads.
with expected_runtime(signature) as (
  values
    ('manage_credits(uuid,numeric,text,text,uuid)'),
    ('transfer_credits(text,numeric,text)'),
    ('restore_stock(uuid)'),
    ('approve_buylist_transaction(uuid,numeric)'),
    ('user_accept_buylist_offer(uuid)'),
    ('decrement_stock(integer,uuid)'),
    ('update_profile_details(text,text,text)'),
    ('submit_order_payment_proof(uuid,text)'),
    ('place_order_atomic(jsonb,text,text,jsonb,boolean,text,text,text)'),
    ('restore_order_inventory_atomic(uuid,text)'),
    ('cancel_order_atomic(uuid,boolean,boolean)'),
    ('refund_order_atomic(uuid,boolean,numeric)'),
    ('remove_order_item_atomic(uuid,integer,boolean)'),
    ('release_expired_orders_atomic(integer,text)'),
    ('get_inventory_metrics(uuid)')
),
runtime_rows as (
  select
    expected.signature,
    routine.oid is not null as present,
    routine.prosecdef as security_definer,
    coalesce(to_jsonb(routine.proconfig), '[]'::jsonb) as proconfig,
    case when routine.oid is null then null else encode(
      extensions.digest(convert_to(pg_get_functiondef(routine.oid), 'UTF8'), 'sha256'), 'hex'
    ) end as definition_sha256,
    case when routine.oid is null then null else has_function_privilege('public', routine.oid, 'EXECUTE') end as public_execute,
    case when routine.oid is null then null else has_function_privilege('anon', routine.oid, 'EXECUTE') end as anon_execute,
    case when routine.oid is null then null else has_function_privilege('authenticated', routine.oid, 'EXECUTE') end as authenticated_execute,
    case when routine.oid is null then null else has_function_privilege('service_role', routine.oid, 'EXECUTE') end as service_role_execute
  from expected_runtime expected
  left join pg_proc routine on routine.oid = to_regprocedure('public.' || expected.signature)
),
runtime_proof as (
  select coalesce(jsonb_agg(to_jsonb(row_value) order by signature), '[]'::jsonb) as value
  from runtime_rows row_value
),
inventory_constraint_rows as (
  select
    relation.relname as table_name,
    constraint_row.conname as constraint_name,
    constraint_row.contype::text as constraint_type,
    constraint_row.convalidated as validated,
    encode(extensions.digest(convert_to(pg_get_constraintdef(constraint_row.oid, true), 'UTF8'), 'sha256'), 'hex') as definition_sha256
  from pg_constraint constraint_row
  join pg_class relation on relation.oid = constraint_row.conrelid
  join pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relname in ('inventories', 'products', 'order_items', 'inventory_stock_movements')
    and (
      relation.relname in ('inventories', 'inventory_stock_movements')
      or constraint_row.conname in ('products_inventory_id_fkey', 'order_items_inventory_id_fkey')
    )
),
inventory_constraint_proof as (
  select coalesce(jsonb_agg(to_jsonb(row_value) order by table_name, constraint_name), '[]'::jsonb) as value
  from inventory_constraint_rows row_value
),
expected_inventory_indexes(index_name) as (
  values
    ('inventories_one_primary_idx'),
    ('inventories_active_name_idx'),
    ('products_inventory_variant_unique_idx'),
    ('products_active_inventory_idx'),
    ('order_items_inventory_id_idx'),
    ('inventory_stock_movements_inventory_idx'),
    ('inventory_stock_movements_order_idx')
),
inventory_index_rows as (
  select
    expected.index_name,
    index_row.indisvalid as valid,
    index_row.indisready as ready,
    encode(extensions.digest(convert_to(pg_get_indexdef(index_row.indexrelid), 'UTF8'), 'sha256'), 'hex') as definition_sha256
  from expected_inventory_indexes expected
  left join pg_class index_relation
    on index_relation.relname = expected.index_name
   and index_relation.relnamespace = 'public'::regnamespace
  left join pg_index index_row on index_row.indexrelid = index_relation.oid
),
inventory_index_proof as (
  select coalesce(jsonb_agg(to_jsonb(row_value) order by index_name), '[]'::jsonb) as value
  from inventory_index_rows row_value
),
inventory_policy_rows as (
  select
    tablename as table_name,
    policyname as policy_name,
    cmd,
    to_jsonb(roles) as roles,
    encode(extensions.digest(convert_to(coalesce(qual, ''), 'UTF8'), 'sha256'), 'hex') as using_sha256,
    encode(extensions.digest(convert_to(coalesce(with_check, ''), 'UTF8'), 'sha256'), 'hex') as check_sha256
  from pg_policies
  where schemaname = 'public'
    and tablename in ('inventories', 'inventory_stock_movements')
),
inventory_policy_proof as (
  select coalesce(jsonb_agg(to_jsonb(row_value) order by table_name, policy_name), '[]'::jsonb) as value
  from inventory_policy_rows row_value
),
inventory_default_proof as (
  select jsonb_agg(
    jsonb_build_object(
      'table_name', table_name,
      'column_name', column_name,
      'data_type', data_type,
      'nullable', is_nullable,
      'default_sha256', encode(extensions.digest(convert_to(coalesce(column_default, ''), 'UTF8'), 'sha256'), 'hex')
    ) order by table_name, column_name
  ) as value
  from information_schema.columns
  where table_schema = 'public'
    and (table_name, column_name) in (
      ('inventories', 'kind'),
      ('products', 'inventory_id'),
      ('products', 'variant_key'),
      ('order_items', 'inventory_id'),
      ('order_items', 'variant_key'),
      ('order_items', 'source_inventory_name')
    )
),
ledger_proof as (
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'version', version,
      'name', name,
      'statements_sha256', encode(
        extensions.digest(convert_to(array_to_string(statements, E'\n'), 'UTF8'), 'sha256'
      ), 'hex')
    ) order by version
  ), '[]'::jsonb) as value
  from supabase_migrations.schema_migrations
),
protected_aggregates as (
  select jsonb_build_object(
    'orders', (select jsonb_build_object(
      'count', count(*),
      'rows_sha256', encode(extensions.digest(convert_to(coalesce(string_agg(to_jsonb(row_value)::text, '|' order by id), ''), 'UTF8'), 'sha256'), 'hex')
    ) from public.orders row_value),
    'profiles', (select jsonb_build_object(
      'count', count(*),
      'rows_sha256', encode(extensions.digest(convert_to(coalesce(string_agg(to_jsonb(row_value)::text, '|' order by id), ''), 'UTF8'), 'sha256'), 'hex')
    ) from public.profiles row_value),
    'products', (select jsonb_build_object(
      'count', count(*),
      'rows_sha256', encode(extensions.digest(convert_to(coalesce(string_agg(to_jsonb(row_value)::text, '|' order by id), ''), 'UTF8'), 'sha256'), 'hex')
    ) from public.products row_value),
    'inventory_movements', (select jsonb_build_object(
      'count', count(*),
      'rows_sha256', encode(extensions.digest(convert_to(coalesce(string_agg(to_jsonb(row_value)::text, '|' order by id), ''), 'UTF8'), 'sha256'), 'hex')
    ) from public.inventory_stock_movements row_value)
  ) as value
),
invariants as (
  select jsonb_build_object(
    'pre_start_commission_periods', (select count(*) from public.commission_periods where period_start < timestamptz '2026-06-01 00:00:00+00'),
    'primary_inventories', (select count(*) from public.inventories where kind = 'primary'),
    'null_product_inventory', (select count(*) from public.products where inventory_id is null),
    'blank_product_variant_key', (select count(*) from public.products where nullif(btrim(variant_key), '') is null),
    'null_order_item_inventory', (select count(*) from public.order_items where inventory_id is null),
    'duplicate_movement_reference_keys', (
      select count(*) from (
        select reference_key from public.inventory_stock_movements group by reference_key having count(*) > 1
      ) duplicate_rows
    ),
    'legacy_search_rpc_count', (
      select count(*)
      from pg_proc routine
      join pg_namespace namespace on namespace.oid = routine.pronamespace
      where namespace.nspname = 'public'
        and routine.proname in ('normalize_text', 'search_orders_v2', 'search_imports_v2')
    )
  ) as value
),
payload as (
  select jsonb_build_object(
    'ledger', ledger_proof.value,
    'runtime', runtime_proof.value,
    'inventory_constraints', inventory_constraint_proof.value,
    'inventory_indexes', inventory_index_proof.value,
    'inventory_policies', inventory_policy_proof.value,
    'inventory_defaults', inventory_default_proof.value,
    'protected_aggregates', protected_aggregates.value,
    'invariants', invariants.value
  ) as value
  from ledger_proof, runtime_proof, inventory_constraint_proof, inventory_index_proof,
       inventory_policy_proof, inventory_default_proof, protected_aggregates, invariants
)
select jsonb_build_object(
  'snapshot_sha256', encode(extensions.digest(convert_to(payload.value::text, 'UTF8'), 'sha256'), 'hex'),
  'ledger_count', jsonb_array_length(payload.value -> 'ledger'),
  'runtime_count', jsonb_array_length(payload.value -> 'runtime'),
  'runtime_sha256', encode(extensions.digest(convert_to((payload.value -> 'runtime')::text, 'UTF8'), 'sha256'), 'hex'),
  'inventory_constraint_count', jsonb_array_length(payload.value -> 'inventory_constraints'),
  'inventory_constraints_sha256', encode(extensions.digest(convert_to((payload.value -> 'inventory_constraints')::text, 'UTF8'), 'sha256'), 'hex'),
  'inventory_index_count', jsonb_array_length(payload.value -> 'inventory_indexes'),
  'inventory_indexes_sha256', encode(extensions.digest(convert_to((payload.value -> 'inventory_indexes')::text, 'UTF8'), 'sha256'), 'hex'),
  'inventory_policy_count', jsonb_array_length(payload.value -> 'inventory_policies'),
  'inventory_policies_sha256', encode(extensions.digest(convert_to((payload.value -> 'inventory_policies')::text, 'UTF8'), 'sha256'), 'hex'),
  'inventory_defaults_sha256', encode(extensions.digest(convert_to((payload.value -> 'inventory_defaults')::text, 'UTF8'), 'sha256'), 'hex'),
  'protected_aggregates', payload.value -> 'protected_aggregates',
  'invariants', payload.value -> 'invariants'
) as production_reconciliation_preflight
from payload;
