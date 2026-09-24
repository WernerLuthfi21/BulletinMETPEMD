-- ============================================================================
-- METP Digital Engineering Bulletin — Supabase schema
-- ----------------------------------------------------------------------------
-- Run this once in your Supabase project's SQL editor (Database → SQL editor).
-- It creates the tables, enables Row Level Security everywhere, and adds the
-- policies that let the public site read published content and let admins
-- (listed in the `admins` table) manage everything.
--
-- After running this:
--   1. Create a Storage bucket named "bulletins" and set it to PRIVATE
--      (Storage → New bucket → uncheck "Public bucket"). The policies below
--      grant access through the app, not through public URLs.
--   2. Create your admin's login: Authentication → Users → Add user
--      (email + password, or invite by email).
--   3. Copy that user's UID and run:
--        insert into public.admins (user_id) values ('paste-uid-here');
--      Only UIDs listed in `admins` can write issues/comments/quotes or
--      upload files — everyone else (including other authenticated users)
--      is treated as a normal visitor.
-- ============================================================================

-- ---------------------------------------------------------------- extensions
create extension if not exists pgcrypto; -- for gen_random_uuid()

-- ------------------------------------------------------------------- admins
-- Whitelist of Supabase Auth user IDs allowed to administer the bulletin.
-- Nothing in the frontend can write to this table (no INSERT/UPDATE policy
-- at all) — you manage it from the SQL editor or the Supabase dashboard.
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;

-- A logged-in user may check whether *they themselves* are an admin
-- (the admin panel uses this to decide whether to show the dashboard).
create policy "admins can read own row"
  on public.admins for select
  using (auth.uid() = user_id);

-- Helper used by every other policy below.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- -------------------------------------------------------------------- issues
create table if not exists public.issues (
  id uuid primary key default gen_random_uuid(),
  month int not null check (month between 1 and 12),
  year int not null check (year between 2000 and 2100),
  title text not null default '',
  editor_chief text not null default '',
  editors text[] not null default '{}',
  contributors text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft','published')),
  file_path text,                 -- path inside the "bulletins" storage bucket
  file_type text,                 -- 'pdf' | 'png' | 'jpg' | 'jpeg'
  page_count int,                 -- filled in by the admin panel after upload
  highlights jsonb not null default '[]'::jsonb,  -- [{heading,text}, ...] text version
  published_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (year, month)
);
alter table public.issues enable row level security;

create policy "public reads published issues"
  on public.issues for select
  using (status = 'published');

create policy "admins read all issues"
  on public.issues for select
  using (public.is_admin());

create policy "admins insert issues"
  on public.issues for insert
  with check (public.is_admin());

create policy "admins update issues"
  on public.issues for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "admins delete issues"
  on public.issues for delete
  using (public.is_admin());

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists issues_set_updated_at on public.issues;
create trigger issues_set_updated_at
  before update on public.issues
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------ comments
-- "Reader suggestions" pinned to the desk. Anyone can submit one (always
-- landing as 'pending'); only approved ones are publicly visible; only
-- admins can see/moderate the pending & rejected ones.
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  name text,
  message text not null check (char_length(message) between 1 and 500),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now()
);
alter table public.comments enable row level security;

create policy "public reads approved comments"
  on public.comments for select
  using (status = 'approved');

create policy "admins read all comments"
  on public.comments for select
  using (public.is_admin());

-- Public can submit a suggestion, but only ever as 'pending' — they cannot
-- insert a row that is already approved.
create policy "public can submit a pending comment"
  on public.comments for insert
  with check (status = 'pending');

create policy "admins update comments"
  on public.comments for update
  using (public.is_admin())
  with check (true);

create policy "admins delete comments"
  on public.comments for delete
  using (public.is_admin());

-- -------------------------------------------------------------------- quotes
create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  quote text not null check (char_length(quote) between 1 and 200),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.quotes enable row level security;

create policy "public reads active quotes"
  on public.quotes for select
  using (active = true);

create policy "admins read all quotes"
  on public.quotes for select
  using (public.is_admin());

create policy "admins insert quotes"
  on public.quotes for insert
  with check (public.is_admin());

create policy "admins update quotes"
  on public.quotes for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "admins delete quotes"
  on public.quotes for delete
  using (public.is_admin());

-- ============================================================================
-- Storage — run after creating the "bulletins" bucket (private).
-- ============================================================================

-- Anyone (including anonymous visitors) may have a signed URL generated for
-- a bulletin file — this SELECT policy is what createSignedUrl() relies on.
-- It does NOT expose a public/browsable URL; without a signed token the
-- object still cannot be fetched.
create policy "anyone can read bulletin objects for signed URLs"
  on storage.objects for select
  using (bucket_id = 'bulletins');

create policy "admins upload bulletin files"
  on storage.objects for insert
  with check (bucket_id = 'bulletins' and public.is_admin());

create policy "admins update bulletin files"
  on storage.objects for update
  using (bucket_id = 'bulletins' and public.is_admin())
  with check (bucket_id = 'bulletins' and public.is_admin());

create policy "admins delete bulletin files"
  on storage.objects for delete
  using (bucket_id = 'bulletins' and public.is_admin());

-- ============================================================================
-- Optional: seed a couple of quotes so the sticky note has content to show
-- from day one even before an admin adds more. Safe to skip or edit.
-- ============================================================================
insert into public.quotes (quote) values
  ('Measure twice, cut once, then check the drawing revision.'),
  ('A drawing is a promise. Keep it.'),
  ('Genba never lies. Go and see.')
on conflict do nothing;
