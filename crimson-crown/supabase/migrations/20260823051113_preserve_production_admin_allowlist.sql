begin;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and (
        role = 'admin'
        or lower(email) in ('mjperchezabala@gmail.com', 'crimsoncrownimports@gmail.com')
      )
  );
$$;

revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

commit;
