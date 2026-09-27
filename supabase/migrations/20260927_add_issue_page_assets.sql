-- METP: store each logical bulletin page as an independently managed asset.
-- Existing single-file issues are backfilled so the rollout does not break them.

alter table public.issues
  add column if not exists display_page_count int;

update public.issues
set display_page_count = least(greatest(coalesce(page_count, 1), 1), 2)
where display_page_count is null;

alter table public.issues
  alter column display_page_count set default 1,
  alter column display_page_count set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'issues_display_page_count_check'
      and conrelid = 'public.issues'::regclass
  ) then
    alter table public.issues
      add constraint issues_display_page_count_check
      check (display_page_count between 1 and 2);
  end if;
end $$;

create table if not exists public.issue_pages (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues(id) on delete cascade,
  page_number int not null check (page_number between 1 and 2),
  file_path text not null,
  file_type text not null check (lower(file_type) in ('pdf','png','jpg','jpeg')),
  source_page int not null default 1 check (source_page >= 1),
  source_page_count int not null default 1 check (source_page_count >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (issue_id, page_number),
  check (source_page <= source_page_count)
);

alter table public.issue_pages enable row level security;

grant select on table public.issue_pages to anon;
grant select, insert, update, delete on table public.issue_pages to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where policyname = 'public reads published issue pages'
      and schemaname = 'public' and tablename = 'issue_pages'
  ) then
    create policy "public reads published issue pages"
      on public.issue_pages for select
      using (exists (
        select 1 from public.issues i
        where i.id = issue_pages.issue_id and i.status = 'published'
      ));
  end if;
  if not exists (
    select 1 from pg_policies
    where policyname = 'admins read all issue pages'
      and schemaname = 'public' and tablename = 'issue_pages'
  ) then
    create policy "admins read all issue pages"
      on public.issue_pages for select
      using (public.is_admin());
  end if;
  if not exists (
    select 1 from pg_policies
    where policyname = 'admins insert issue pages'
      and schemaname = 'public' and tablename = 'issue_pages'
  ) then
    create policy "admins insert issue pages"
      on public.issue_pages for insert
      with check (public.is_admin());
  end if;
  if not exists (
    select 1 from pg_policies
    where policyname = 'admins update issue pages'
      and schemaname = 'public' and tablename = 'issue_pages'
  ) then
    create policy "admins update issue pages"
      on public.issue_pages for update
      using (public.is_admin())
      with check (public.is_admin());
  end if;
  if not exists (
    select 1 from pg_policies
    where policyname = 'admins delete issue pages'
      and schemaname = 'public' and tablename = 'issue_pages'
  ) then
    create policy "admins delete issue pages"
      on public.issue_pages for delete
      using (public.is_admin());
  end if;
end $$;

insert into public.issue_pages (
  issue_id, page_number, file_path, file_type, source_page, source_page_count
)
select
  i.id,
  gs.page_number,
  i.file_path,
  lower(i.file_type),
  gs.page_number,
  greatest(coalesce(i.page_count, 1), 1)
from public.issues i
cross join lateral generate_series(
  1,
  least(greatest(coalesce(i.page_count, 1), 1), 2)
) as gs(page_number)
where i.file_path is not null
  and lower(coalesce(i.file_type, '')) in ('pdf','png','jpg','jpeg')
on conflict (issue_id, page_number) do nothing;
