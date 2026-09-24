/* ==========================================================================
   METP Bulletin — public configuration
   --------------------------------------------------------------------------
   Leave both values empty to run in DEMO MODE (bundled issue, suggestions
   stored only on this browser). To enable the shared backend, fill in your
   Supabase project values — see README.md → "Backend setup".

   These two values are PUBLIC by design (the anon key is safe in a browser
   *because* Row Level Security protects the data). NEVER put a service-role
   key here.
   ========================================================================== */
window.METP_CONFIG = {
  supabaseUrl: "https://bkdzkxezpabfqbhsgzhb.supabase.co",       // e.g. "https://abcdxyzcompany.supabase.co"
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJrZHpreGV6cGFiZnFiaHNnemhiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxMjIyMjcsImV4cCI6MjEwNTY5ODIyN30.cZG5lyh9bf0jKCxmtN5-nYiaG-0pCCXgFqSt0ZAJZ0s",   // the project's public "anon" key
  bucket: "bulletins",   // private Storage bucket that holds uploaded issues
  maxUploadMB: 50        // client-side upload limit (also set it in Supabase)
};
