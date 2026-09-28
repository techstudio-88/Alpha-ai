-- Keep the public wrappers invoker-security while preventing anonymous execution.
revoke execute on function public.ensure_my_workspace() from public, anon;
revoke execute on function public.is_workspace_member(uuid) from public, anon;
revoke execute on function public.issue_processing_ticket(uuid,uuid,uuid,uuid,uuid) from public, anon;

grant execute on function public.ensure_my_workspace() to authenticated;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.issue_processing_ticket(uuid,uuid,uuid,uuid,uuid) to authenticated;
