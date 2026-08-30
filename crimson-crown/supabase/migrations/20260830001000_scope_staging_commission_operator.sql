begin;

-- Production admins retain their existing access. The sole extra operator is
-- enabled only in a database carrying the exact synthetic staging fixture;
-- the application independently binds this identity to target=staging and the
-- configured staging project ref before issuing privileged requests.
create or replace function public.is_commission_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (
    public.is_admin()
    or (
      exists (
        select 1
        from public.profiles
        where id = (select auth.uid())
          and lower(email) = 'operator.crimson.staging@example.test'
          and role = 'user'
      )
      and exists (
        select 1
        from public.inventories
        where id = 'c0de0001-0000-4000-8000-000000000001'::uuid
          and description = 'codex-staging-p0:inventory'
      )
    )
  );
$$;

revoke all on function public.is_commission_admin() from public, anon;
grant execute on function public.is_commission_admin() to authenticated, service_role;

commit;
