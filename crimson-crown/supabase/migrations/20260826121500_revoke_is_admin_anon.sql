begin;

-- Supabase may provision default grants for newly-created functions. Keep the
-- authorization helper unavailable to anonymous clients explicitly.
revoke all on function public.is_admin() from anon, public;
grant execute on function public.is_admin() to authenticated, service_role;

commit;
