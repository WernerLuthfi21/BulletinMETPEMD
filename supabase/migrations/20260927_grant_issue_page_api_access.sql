-- METP: expose issue_pages through the Supabase Data API.
-- RLS still controls which rows each role can access.
grant select on table public.issue_pages to anon;
grant select, insert, update, delete on table public.issue_pages to authenticated;
