begin;

do $$
begin
  if to_regprocedure('public.handle_new_user()') is null then
    raise exception 'La réplica local no contiene public.handle_new_user().';
  end if;

  if not exists (
    select 1
    from pg_trigger trigger_entry
    join pg_class relation on relation.oid = trigger_entry.tgrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'auth'
      and relation.relname = 'users'
      and trigger_entry.tgname = 'on_auth_user_created'
      and not trigger_entry.tgisinternal
  ) then
    create trigger on_auth_user_created
      after insert on auth.users
      for each row execute function public.handle_new_user();
  end if;
end
$$;

commit;
