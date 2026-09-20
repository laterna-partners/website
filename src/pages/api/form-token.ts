// GET /api/form-token: issues a short signed token the client stores in a
// hidden `form_token` input. It proves the page was actually fetched and lets
// the server enforce a minimum time-to-submit. See src/lib/form-guard.ts.
import type { APIRoute } from 'astro';
import { issueFormToken } from '../../lib/form-guard';

export const prerender = false;

export const GET: APIRoute = async () => {
  const token = issueFormToken();
  return new Response(JSON.stringify({ token }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
};
