-- METP: allow each monthly issue to display as one or two logical pages.
-- page_count remains the number of pages in the uploaded source file.
alter table public.issues
  add column if not exists display_page_count int not null default 2;

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
