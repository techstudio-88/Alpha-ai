create policy templates_insert
on public.templates
for insert
to authenticated
with check (is_workspace_member(workspace_id));

create policy templates_update
on public.templates
for update
to authenticated
using (is_workspace_member(workspace_id))
with check (is_workspace_member(workspace_id));

create policy templates_delete
on public.templates
for delete
to authenticated
using (is_workspace_member(workspace_id));