-- Phase 1: persist word-level transcript timing for captions/editor sync.
create table if not exists public.transcript_words (
  id uuid primary key default gen_random_uuid(),
  transcript_id uuid not null references public.transcripts(id) on delete cascade,
  start_ms bigint not null,
  end_ms bigint not null,
  word text not null,
  confidence numeric,
  created_at timestamptz not null default now(),
  constraint transcript_words_time_check check (end_ms > start_ms)
);
create index if not exists transcript_words_transcript_time_idx on public.transcript_words(transcript_id,start_ms,end_ms);
alter table public.transcript_words enable row level security;
drop policy if exists "transcript_words_member_all" on public.transcript_words;
create policy "transcript_words_member_all" on public.transcript_words for all to authenticated
using (exists (select 1 from public.transcripts t join public.media_assets m on m.id=t.media_asset_id where t.id=transcript_words.transcript_id and is_workspace_member(m.workspace_id)))
with check (exists (select 1 from public.transcripts t join public.media_assets m on m.id=t.media_asset_id where t.id=transcript_words.transcript_id and is_workspace_member(m.workspace_id)));