// Supabase client — server-side, uses service_role key for inserts.
// Logs QR scans and form submissions. Optional: returns null if env not set yet
// so the site still works during early local dev before the Laterna Supabase
// project exists.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null | undefined;

export function getSupabase(): SupabaseClient | null {
  if (_client !== undefined) return _client;

  const url = import.meta.env.PUBLIC_SUPABASE_URL;
  const key = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.warn('[supabase] env not configured — skipping persistence');
    _client = null;
    return null;
  }

  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}
