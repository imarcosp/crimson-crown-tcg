do $verify_privileged_surfaces$
declare
  surface record;
  function_oid oid;
  function_owner oid;
  actual_runtime_roles text[];
  unexpected_grantees text[];
  runtime_role text;
  expected_effective_privilege boolean;
  actual_effective_privilege boolean;
begin
  if to_regclass('pg_temp.expected_privileged_surfaces') is null then
    raise exception 'expected_privileged_surfaces temp table is required';
  end if;

  if (select count(*) from pg_temp.expected_privileged_surfaces) <> 24 then
    raise exception 'expected exactly 24 privileged surfaces';
  end if;

  if not exists (
    select 1
    from pg_class as c
    where c.oid = 'public.admin_users'::regclass
      and c.relkind = 'v'
      and coalesce(c.reloptions, array[]::text[]) @> array['security_invoker=true']::text[]
  ) then
    raise exception 'public.admin_users must be a security_invoker view';
  end if;

  if has_table_privilege('anon', 'public.admin_users', 'select')
    or has_table_privilege('authenticated', 'public.admin_users', 'select') then
    raise exception 'public.admin_users must deny anon and authenticated';
  end if;

  for surface in
    select signature, allowed_roles
    from pg_temp.expected_privileged_surfaces
    order by signature
  loop
    function_oid := to_regprocedure('public.' || surface.signature);
    if function_oid is null then
      raise exception 'missing privileged function: %', surface.signature;
    end if;

    select p.proowner
    into function_owner
    from pg_proc as p
    where p.oid = function_oid;

    if not exists (
      select 1
      from pg_proc as p
      where p.oid = function_oid
        and p.proconfig = array['search_path=public, pg_temp']::text[]
    ) then
      raise exception 'unexpected search_path for %', surface.signature;
    end if;

    select coalesce(array_agg(r.rolname order by r.rolname), array[]::text[])
    into actual_runtime_roles
    from pg_proc as p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as acl
    join pg_roles as r on r.oid = acl.grantee
    where p.oid = function_oid
      and acl.privilege_type = 'EXECUTE'
      and r.rolname = any(array['anon', 'authenticated', 'service_role']::text[]);

    if actual_runtime_roles <> (
      select array_agg(role_name order by role_name)
      from unnest(surface.allowed_roles) as role_name
    ) then
      raise exception 'unexpected runtime ACL for %', surface.signature;
    end if;

    foreach runtime_role in array array['anon', 'authenticated', 'service_role']::text[]
    loop
      expected_effective_privilege := runtime_role = any(surface.allowed_roles);
      select has_function_privilege(r.oid, function_oid, 'EXECUTE')
      into actual_effective_privilege
      from pg_roles as r
      where r.rolname = runtime_role;

      if actual_effective_privilege is null
        or actual_effective_privilege <> expected_effective_privilege then
        raise exception 'unexpected effective runtime privilege for % on %', runtime_role, surface.signature;
      end if;
    end loop;

    if exists (
      select 1
      from pg_proc as p
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as acl
      where p.oid = function_oid
        and acl.privilege_type = 'EXECUTE'
        and acl.grantee = 0
    ) then
      raise exception 'PUBLIC still has EXECUTE on %', surface.signature;
    end if;

    select coalesce(array_agg(coalesce(r.rolname, acl.grantee::text) order by coalesce(r.rolname, acl.grantee::text)), array[]::text[])
    into unexpected_grantees
    from pg_proc as p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as acl
    left join pg_roles as r on r.oid = acl.grantee
    where p.oid = function_oid
      and acl.privilege_type = 'EXECUTE'
      -- Supabase mantiene EXECUTE explícito para postgres, además del owner.
      -- allowed_roles modela exclusivamente los roles runtime de Data API.
      and acl.grantee <> function_owner
      and coalesce(r.rolname, '') <> 'postgres'
      and not (coalesce(r.rolname, '') = any(surface.allowed_roles));

    if cardinality(unexpected_grantees) > 0 then
      raise exception 'unexpected EXECUTE grantees for %', surface.signature;
    end if;
  end loop;

  if (
    select count(*)
    from pg_temp.expected_privileged_surfaces
    where 'authenticated' = any(allowed_roles)
  ) <> 1 or not exists (
    select 1
    from pg_temp.expected_privileged_surfaces
    where signature = 'is_commission_admin()'
      and allowed_roles = array['authenticated', 'service_role']::text[]
  ) then
    raise exception 'authenticated authorization inventory is not exact';
  end if;
end
$verify_privileged_surfaces$;
