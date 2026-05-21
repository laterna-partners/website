// Maps a known QR ref to a site-hint phrase shown in the Hero ("the land at...").
// This is a temporary in-code table; once outreach scales we move it to Supabase.
//
// Add entries as you generate letters. The string is rendered inline after
// "the land at ", e.g. ref "SITE-26-0418" → hero shows
//   "the land at the two-acre paddock east of Pilgrims Lane"

export const SITE_HINTS: Record<string, string> = {
  // demo entry from the prototype — keep until first real letter ships
  'SITE-26-0418': 'the two-acre paddock east of Pilgrims Lane',
};

export function lookupSiteHint(ref: string | null | undefined): string | null {
  if (!ref) return null;
  return SITE_HINTS[ref] ?? null;
}
