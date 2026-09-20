-- Alpha.ai privileged workspace export permissions
alter table public.workspace_members
  add column if not exists can_export boolean not null default false;

update public.workspace_members wm
set can_export = true
from public.workspaces w
where w.id = wm.workspace_id
  and w.owner_id = wm.user_id;

revoke execute on function public.ensure_my_workspace() from public, anon;
grant execute on function public.ensure_my_workspace() to authenticated;
revoke execute on function public.is_workspace_member(uuid) from public, anon;
grant execute on function public.is_workspace_member(uuid) to authenticated;
