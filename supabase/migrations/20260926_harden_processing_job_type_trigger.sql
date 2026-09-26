create or replace function public.normalize_processing_job_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.job_type is null or btrim(new.job_type)='' then
    new.job_type := case
      when coalesce(new.payload->>'operation','')='render_edit' then 'render_edit'
      when coalesce(new.payload->>'sourceType','')<>'' or coalesce(new.payload->>'source_type','')<>'' then 'import_media'
      else 'process_media'
    end;
  end if;
  return new;
end;
$$;

revoke all on function public.normalize_processing_job_type() from public, anon, authenticated;