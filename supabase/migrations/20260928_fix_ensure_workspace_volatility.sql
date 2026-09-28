-- Fix post-login workspace bootstrap: this function creates/updates records, so it must be VOLATILE.
create or replace function public.ensure_my_workspace()
returns public.workspaces
language sql
volatile
security definer
set search_path = public, pg_temp
as $function$
  select private.ensure_my_workspace();
$function$;
revoke all on function public.ensure_my_workspace() from public;
grant execute on function public.ensure_my_workspace() to authenticated, service_role;