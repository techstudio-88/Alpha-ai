-- Restore the secure public-to-private RPC boundary.
-- Public wrappers execute with their owner privileges so authenticated clients
-- never need USAGE on the private schema.
alter function public.ensure_my_workspace()
  security definer
  set search_path = public, pg_temp;

alter function public.is_workspace_member(uuid)
  security definer
  set search_path = public, pg_temp;

alter function public.issue_processing_ticket(uuid,uuid,uuid,uuid,uuid)
  security definer
  set search_path = public, pg_temp;

revoke execute on function private.ensure_my_workspace() from public, anon, authenticated;
revoke execute on function private.is_workspace_member(uuid) from public, anon, authenticated;
revoke execute on function private.issue_processing_ticket(uuid,uuid,uuid,uuid,uuid) from public, anon, authenticated;
