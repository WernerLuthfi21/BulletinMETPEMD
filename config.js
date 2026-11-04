/* ==========================================================================
   METP Bulletin — public configuration
   --------------------------------------------------------------------------
   Leave both values empty to run in DEMO MODE (bundled issue, suggestions
   stored only on this browser). To enable the shared backend, fill in your
   Supabase project values — see README.md → "Backend setup".

   The URL and publishable key are PUBLIC by design (the key is safe in a browser
   *because* Row Level Security protects the data). NEVER put a service-role
   key here.
   ========================================================================== */
window.METP_CONFIG = {
  supabaseUrl: "https://bkdzkxezpabfqbhsgzhb.supabase.co",       // e.g. "https://abcdxyzcompany.supabase.co"
  supabasePublishableKey: "sb_publishable_hwhYrVKKHnxToGnR1ZeJuA_5AjMROIK",   // the project's public publishable key
  bucket: "bulletins",   // private Storage bucket that holds uploaded issues
  maxUploadMB: 50        // client-side upload limit (also set it in Supabase)
};
