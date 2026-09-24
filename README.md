# METP Digital Engineering Bulletin

A static, interactive physical-binder bulletin for the Material Engineering &
Technical Planning team. Plain HTML/CSS/vanilla JS — no build step, no
framework, no WebGL. Deploy by uploading the folder as-is.

## What's inside

```
index.html          Public site — the binder
admin.html           Admin panel (issues, uploads, comments, quotes)
css/site.css          Public site styles
css/admin.css         Admin styles
js/                    binder.js (flip engine), reader.js, props.js,
                       comments.js, data.js, admin.js, util.js
config.js               Fill in to enable the shared backend (optional)
data/issues.js           Bundled issue(s) — used in "demo mode" and as an
                          offline fallback if the backend is unreachable
data/quotes.js            Bundled quote-of-the-day pool
assets/textures/            Generated desk/paper/cover textures
assets/issues/                Bundled bulletin PDF + pre-rendered page images
assets/fonts/                   Self-hosted webfonts (no external CDN calls)
vendor/pdfjs, vendor/supabase      Vendored libraries (pdf.js, supabase-js)
supabase/schema.sql                  Backend schema (tables + RLS policies)
```

## Running it locally

Any static server works, e.g.:

```
python3 -m http.server 8000
```

then open `http://localhost:8000/index.html`.

## Deploying

Upload the whole folder to GitHub Pages, Netlify, Vercel (static), or any
web server. There is no build step — what you see is what ships.

## Demo mode (no backend)

Out of the box the site works with **zero configuration**: it reads
`data/issues.js` and `data/quotes.js`, and reader suggestions are stored in
the visitor's own browser (`localStorage`). This is enough to preview and
deploy the August 2026 issue today.

## Enabling the shared backend (optional)

To let an admin publish new issues, upload files, and moderate suggestions
that everyone sees, connect a free [Supabase](https://supabase.com) project:

1. **Create a project** at supabase.com.
2. **Run the schema.** Open the SQL editor and run the full contents of
   `supabase/schema.sql`. This creates the `issues`, `comments`, `quotes`
   and `admins` tables with Row Level Security already locked down.
3. **Create a private Storage bucket** named `bulletins`
   (Storage → New bucket → leave "Public bucket" **unchecked**).
4. **Create your admin login.** Authentication → Users → Add user (email +
   password is simplest). Copy the new user's UID.
5. **Whitelist that admin**, back in the SQL editor:
   ```sql
   insert into public.admins (user_id) values ('paste-the-uid-here');
   ```
   Only UIDs listed here can write anything — every other visitor, signed in
   or not, is treated as a read-only member of the public.
6. **Fill in `config.js`** with your project's URL and anon (public) key,
   both found in Project Settings → API:
   ```js
   window.METP_CONFIG = {
     supabaseUrl: "https://xxxxxxxx.supabase.co",
     supabaseAnonKey: "eyJ...",
     bucket: "bulletins",
     maxUploadMB: 25
   };
   ```
   The anon key is meant to be public — every write it can make is enforced
   server-side by the RLS policies in step 2. **Never** put a service-role
   key here or anywhere in the frontend.
7. Reload `index.html` and `admin.html`. Sign in to the admin panel at
   `admin.html` with the login from step 4.

If the backend becomes unreachable later, the public site automatically
falls back to the bundled `data/issues.js` and shows a small notice — it
never shows a blank page.

## Adding future issues

**With the backend:** sign in to `admin.html` → "New issue" → fill in the
month/year/credits, drag in the PDF/PNG/JPG, optionally fill in the text
version (used by the reader and screen readers), tick "Published", save.

**Without the backend (editing bundled data):** add a new object to
`window.METP_ISSUES` in `data/issues.js` and drop the file in
`assets/issues/`. Pre-rendering a PDF to WebP page images (as the bundled
August issue does) keeps the binder fast — pdf.js is only used as a
fallback for issues that don't have `pages` pre-rendered.

## Notes

- The public site never uses a Supabase service-role key, never trusts a
  client-side "admin flag", and the admin panel's own writes only succeed
  because of server-side RLS — inspecting the frontend source gives no way
  to bypass it.
- Comments/suggestions always land as `pending`; only an admin action makes
  them visible on the public site, and the public page only ever shows the
  1–3 most recent approved ones.
- Respects `prefers-reduced-motion` (opening/flip animations are skipped)
  and is fully keyboard-operable (Tab, Enter/Space, ←/→ for pages).
