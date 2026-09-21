// POST /api/click: fire-and-forget click tracking for the tel:/wa.me/mailto:
// links (Call, WhatsApp, Email). Always responds 204 so the client's
// sendBeacon or fetch-with-keepalive call never has to branch on the result.
import type { APIRoute } from 'astro';
import { getSupabase } from '../../lib/supabase';
import { getClientIp, checkRateLimit, isAllowedOrigin } from '../../lib/form-guard';

export const prerender = false;

const ALLOWED_CHANNELS = new Set(['call', 'whatsapp', 'email']);
const REF_RE = /^SITE-[A-Z0-9-]{3,40}$/i;

function noContent(): Response {
  return new Response(null, { status: 204 });
}

export const POST: APIRoute = async ({ request }) => {
  // sendBeacon posts as text/plain by default; some browsers use
  // application/json. Either way the body is a JSON string, so read it as
  // text first rather than relying on a specific content type.
  let payload: { channel?: unknown; ref?: unknown };
  try {
    const raw = await request.text();
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    return noContent();
  }

  // Same allowlist as the form routes. A bad origin is silently dropped, not
  // surfaced, since the caller never inspects the response body.
  if (!isAllowedOrigin(request)) return noContent();

  // A light, separate rate-limit bucket from the form routes so tapping a
  // couple of channel links doesn't eat into the contact-form allowance.
  const ip = getClientIp(request);
  if (!checkRateLimit(`click:${ip}`)) return noContent();

  const channel = typeof payload.channel === 'string' ? payload.channel : null;
  if (!channel || !ALLOWED_CHANNELS.has(channel)) return noContent();

  const rawRef = typeof payload.ref === 'string' ? payload.ref : null;
  const ref = rawRef && REF_RE.test(rawRef) ? rawRef.toUpperCase() : null;

  // Best-effort, fire-and-forget insert, same posture as middleware.ts's
  // qr_scans insert: never awaited, a failure is only logged.
  const supabase = getSupabase();
  if (supabase) {
    const userAgent = request.headers.get('user-agent') ?? null;
    const path = new URL(request.url).pathname;
    supabase
      .from('click_events')
      .insert({ channel, ref, path, user_agent: userAgent })
      .then(({ error }) => {
        if (error) console.error('[click_events] insert failed', error.message);
      });
  }

  return noContent();
};
