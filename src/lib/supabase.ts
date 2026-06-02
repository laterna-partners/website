// Supabase client. Server-side, uses the publishable (anon) key. RLS policies
// on the target tables allow anon INSERT only (no SELECT/UPDATE/DELETE), so the
// key is safe to ship even if it leaks. Reading the rows is done via the
// Supabase dashboard with Hayri's auth.
// Returns null if env not set, so the site still works during local dev.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null | undefined;

export function getSupabase(): SupabaseClient | null {
  if (_client !== undefined) return _client;

  const url = import.meta.env.SUPABASE_URL;
  const key = import.meta.env.SUPABASE_KEY;

  if (!url || !key) {
    console.warn('[supabase] env not configured; skipping persistence');
    _client = null;
    return null;
  }

  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}
