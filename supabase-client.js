// ============================================================
// SCORE MY COMBINE — Supabase client (shared by all pages)
// ============================================================
// NOTE: service role key is NOT included here — anon key only.
// Admin operations that need elevated access go through the
// Supabase dashboard or a server-side function.

const SUPABASE_URL  = 'https://oldsraltxmkghplaqabl.supabase.co';
const SUPABASE_ANON = 'sb_publishable_LHsiVA3k1IK3nvhcQNKnEg_QKPhrGr8';

// Current event slug — override with ?event=ae2027 in URL
const EVENT_ID = (() => {
  const p = new URLSearchParams(window.location.search);
  return p.get('event') || 'demo';
})();

// Supabase JS v2 loaded via CDN in each HTML file
// Pages that use this file must load the CDN script FIRST:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.0/dist/umd/supabase.min.js"></script>
//   <script src="supabase-client.js"></script>

let _sb = null;
function getSB() {
  if (!_sb) _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
  return _sb;
}
