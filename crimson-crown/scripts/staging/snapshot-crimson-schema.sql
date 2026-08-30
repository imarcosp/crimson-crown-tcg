with migration_rows as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'version', version,
        'name', name,
        'statements_sha256', encode(
          extensions.digest(convert_to(array_to_string(statements, E'\n'), 'UTF8'), 'sha256'
        ), 'hex')
      ) order by version
    ),
    '[]'::jsonb
  ) as value
  from supabase_migrations.schema_migrations
),
relation_rows as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'schema', namespace.nspname,
        'name', relation.relname,
        'kind', relation.relkind,
        'rls', relation.relrowsecurity,
        'force_rls', relation.relforcerowsecurity,
        'signature_sha256', encode(
          extensions.digest(
            convert_to(concat_ws('|',
              namespace.nspname,
              relation.relname,
              relation.relkind::text,
              relation.relrowsecurity::text,
              relation.relforcerowsecurity::text,
              coalesce((
                select string_agg(
                  concat_ws(':', attribute.attnum::text, attribute.attname,
                    pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
                    attribute.attnotnull::text,
                    coalesce(pg_get_expr(default_value.adbin, default_value.adrelid), '')),
                  ',' order by attribute.attnum
                )
                from pg_catalog.pg_attribute attribute
                left join pg_catalog.pg_attrdef default_value
                  on default_value.adrelid = attribute.attrelid
                 and default_value.adnum = attribute.attnum
                where attribute.attrelid = relation.oid
                  and attribute.attnum > 0
                  and not attribute.attisdropped
              ), ''),
              coalesce((
                select string_agg(pg_get_constraintdef(constraint_row.oid, true), ',' order by constraint_row.conname)
                from pg_catalog.pg_constraint constraint_row
                where constraint_row.conrelid = relation.oid
              ), ''),
              coalesce((
                select string_agg(pg_get_indexdef(index_row.indexrelid), ',' order by index_row.indexrelid::regclass::text)
                from pg_catalog.pg_index index_row
                where index_row.indrelid = relation.oid
              ), '')
            ), 'UTF8'),
            'sha256'
          ),
          'hex'
        )
      ) order by namespace.nspname, relation.relname
    ),
    '[]'::jsonb
  ) as value
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relkind in ('r', 'p', 'v', 'm', 'S')
),
function_rows as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'signature', routine.oid::regprocedure::text,
        'security_definer', routine.prosecdef,
        'proconfig', coalesce(to_jsonb(routine.proconfig), '[]'::jsonb),
        'definition_sha256', encode(
          extensions.digest(convert_to(pg_get_functiondef(routine.oid), 'UTF8'), 'sha256'), 'hex'
        )
      ) order by routine.oid::regprocedure::text
    ),
    '[]'::jsonb
  ) as value
  from pg_catalog.pg_proc routine
  join pg_catalog.pg_namespace namespace on namespace.oid = routine.pronamespace
  where namespace.nspname = 'public'
),
grant_source as (
  select 'table'::text as object_kind, table_schema || '.' || table_name as object_name,
    grantee, privilege_type as privilege
  from information_schema.table_privileges
  where table_schema in ('public', 'storage')
  union all
  select 'routine', routine_schema || '.' || routine_name,
    grantee, privilege_type
  from information_schema.routine_privileges
  where routine_schema = 'public'
),
grant_rows as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'object_kind', object_kind,
        'object_name', object_name,
        'grantee', grantee,
        'privilege', privilege
      ) order by object_kind, object_name, grantee, privilege
    ),
    '[]'::jsonb
  ) as value
  from grant_source
),
policy_rows as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'table_name', namespace.nspname || '.' || relation.relname,
        'policy_name', policy.polname,
        'command', policy.polcmd,
        'roles', coalesce((
          select jsonb_agg(role_row.rolname order by role_row.rolname)
          from pg_catalog.pg_roles role_row
          where role_row.oid = any(policy.polroles)
        ), '[]'::jsonb),
        'expression_sha256', encode(
          extensions.digest(convert_to(
            coalesce(pg_get_expr(policy.polqual, policy.polrelid), '') || '|' ||
            coalesce(pg_get_expr(policy.polwithcheck, policy.polrelid), ''),
            'UTF8'
          ), 'sha256'),
          'hex'
        )
      ) order by namespace.nspname, relation.relname, policy.polname
    ),
    '[]'::jsonb
  ) as value
  from pg_catalog.pg_policy policy
  join pg_catalog.pg_class relation on relation.oid = policy.polrelid
  join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname in ('public', 'storage')
),
bucket_rows as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'public', public,
        'file_size_limit', file_size_limit,
        'allowed_mime_types', coalesce(to_jsonb(allowed_mime_types), '[]'::jsonb)
      ) order by id
    ),
    '[]'::jsonb
  ) as value
  from storage.buckets
  where id in ('products', 'banners', 'payment_proofs')
),
count_source as (
  select 'auth.users'::text as object_name, count(*)::bigint as row_count from auth.users
  union all select 'public.profiles', count(*) from public.profiles
  union all select 'public.inventories', count(*) from public.inventories
  union all select 'public.products', count(*) from public.products
  union all select 'public.orders', count(*) from public.orders
  union all select 'public.order_items', count(*) from public.order_items
  union all select 'public.import_orders', count(*) from public.import_orders
  union all select 'public.import_items', count(*) from public.import_items
  union all select 'public.commission_periods', count(*) from public.commission_periods
  union all select 'public.commission_payments', count(*) from public.commission_payments
  union all select 'public.notifications', count(*) from public.notifications
  union all select 'public.credit_transactions', count(*) from public.credit_transactions
  union all select 'storage.banners', count(*) from storage.objects where bucket_id = 'banners'
  union all select 'storage.payment_proofs', count(*) from storage.objects where bucket_id = 'payment_proofs'
  union all select 'storage.products', count(*) from storage.objects where bucket_id = 'products'
),
count_rows as (
  select jsonb_agg(
    jsonb_build_object('object_name', object_name, 'row_count', row_count)
    order by object_name
  ) as value
  from count_source
)
select jsonb_build_object(
  'schema_version', 1,
  'migrations', migration_rows.value,
  'relation_signatures', relation_rows.value,
  'function_signatures', function_rows.value,
  'grants', grant_rows.value,
  'policies', policy_rows.value,
  'buckets', bucket_rows.value,
  'counts', count_rows.value
) as snapshot
from migration_rows, relation_rows, function_rows, grant_rows, policy_rows, bucket_rows, count_rows;
