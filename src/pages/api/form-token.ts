// GET /api/form-token: issues a short signed token the client stores in a
// hidden `form_token` input. It proves the page was actually fetched and lets
// the server enforce a minimum time-to-submit. See src/lib/form-guard.ts.
// Guarded the same way as the form POSTs (origin allowlist, per-IP rate
// limit) so a bot can't mint tokens freely by hitting this route directly.
import type { APIRoute } from 'astro';
import {
  issueFormToken,
  isAllowedOrigin,
  getClientIp,
  checkRateLimit,
  jsonResponse,
} from '../../lib/form-guard';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  if (!isAllowedOrigin(request)) {
    return jsonResponse(403, { ok: false, error: 'bad_origin' });
  }

  const ip = getClientIp(request);
  if (!checkRateLimit(ip)) {
    return jsonResponse(429, { ok: false, error: 'rate_limited' });
  }

  const token = issueFormToken();
  return new Response(JSON.stringify({ token }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
};
