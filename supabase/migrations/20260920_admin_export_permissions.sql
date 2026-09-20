-- Alpha.ai privileged workspace export permissions
alter table public.workspace_members
  add column if not exists can_export boolean not null default false;

update public.workspace_members wm
set can_export = true
from public.workspaces w
where w.id = wm.workspace_id
  and w.owner_id = wm.user_id;