// Middleware: captures ?ref=SITE-xxx on every request, logs the scan to
// Supabase (best-effort, never blocks the response), and attaches the value
// to Astro.locals so pages can read it without parsing the URL themselves.
import { defineMiddleware } from 'astro:middleware';
import { getSupabase } from './lib/supabase';
import { lookupSiteHint } from './lib/site-hints';
import { recordScan } from './lib/attio';

export const onRequest = defineMiddleware(async (context, next) => {
  const url = new URL(context.request.url);
  const rawRef = url.searchParams.get('ref');

  if (rawRef && /^SITE-[A-Z0-9-]{3,40}$/i.test(rawRef)) {
    // Normalise once here so every downstream consumer (locals, qr_scans,
    // site-hints lookup, the forms) sees one canonical casing.
    const ref = rawRef.toUpperCase();
    context.locals.ref = ref;
    context.locals.siteHint = await lookupSiteHint(ref);

    // fire-and-forget, never block the page on logging
    const supabase = getSupabase();
    if (supabase) {
      const userAgent = context.request.headers.get('user-agent') ?? null;
      const referer = context.request.headers.get('referer') ?? null;
      supabase
        .from('qr_scans')
        .insert({
          ref,
          path: url.pathname,
          user_agent: userAgent,
          referer,
        })
        .then(({ error }) => {
          if (error) console.error('[qr_scans] insert failed', error.message);
        });
    } else {
      console.log(`[qr_scan] ${ref} hit ${url.pathname}`);
    }

    // Best-effort CRM mirror. Not awaited: recordScan never throws (it
    // catches internally) and the page must stay fast regardless of Attio's
    // response time.
    recordScan(ref);
  }

  return next();
});
