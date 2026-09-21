// Maps a known QR ref to a site-hint phrase shown in the Hero ("the land at...").
// Looks up Supabase's `site_hints` table first (ref text primary key, hint
// text), kept in sync with the CRM as letters go out, and falls back to the
// in-code map below when Supabase is unavailable or the row is missing. The
// map exists so the page still works in local dev and before the table has
// rows for every ref.
//
// The lookup runs on the page-render critical path (see middleware.ts), so
// it is bounded by a short timeout: a slow or unreachable Supabase call
// degrades to the fallback rather than delaying the page.
import { getSupabase } from './supabase';

export const SITE_HINTS: Record<string, string> = {
  // demo entry from the prototype, keep until first real letter ships
  'SITE-26-0418': 'the two-acre paddock east of Pilgrims Lane',
};

const LOOKUP_TIMEOUT_MS = 1_500;

export async function lookupSiteHint(ref: string | null | undefined): Promise<string | null> {
  if (!ref) return null;
  const key = ref.toUpperCase();

  const supabase = getSupabase();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('site_hints')
        .select('hint')
        .eq('ref', key)
        .abortSignal(AbortSignal.timeout(LOOKUP_TIMEOUT_MS))
        .maybeSingle();

      if (error) {
        console.error('[site-hints] supabase lookup failed, falling back', error.message);
      } else if (data?.hint) {
        return data.hint as string;
      }
    } catch (err) {
      console.error('[site-hints] supabase lookup failed, falling back', err);
    }
  }

  return SITE_HINTS[key] ?? null;
}
