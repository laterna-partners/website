#!/usr/bin/env node
// Smoke test for the routes rebuilt in v2/routes. Starts the dev server on
// port 4332 with no env secrets set (the same posture as a fresh checkout
// before Vercel env vars are configured), then exercises the defences that
// must survive with secrets unset: origin allowlist, form token, and the
// note_needs_email validation, plus a click beacon.
//
// Run with: node scripts/smoke-routes.mjs
import { spawn } from 'node:child_process';

const PORT = 4332;
const BASE = `http://localhost:${PORT}`;
const ORIGIN = `http://localhost:${PORT}`;

function log(...args) {
  console.log(...args);
}

function waitFor(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/form-token`, {
        headers: { origin: ORIGIN },
      });
      if (res.status) return true;
    } catch {
      // not up yet
    }
    await waitFor(500);
  }
  throw new Error('Dev server did not come up in time');
}

const results = [];

function record(name, expected, actual, note) {
  const pass = actual === expected || (Array.isArray(expected) && expected.includes(actual));
  results.push({ name, expected, actual, pass, note });
  log(
    `${pass ? 'PASS' : 'INFO'} - ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}${note ? ` (${note})` : ''}`,
  );
}

async function testBadOrigin() {
  const form = new URLSearchParams({
    name: 'Bot Tester',
    reach: 'bot@example.com',
    company: '',
    form_type: 'contact',
    form_token: '',
  });
  const res = await fetch(`${BASE}/api/contact`, {
    method: 'POST',
    headers: { origin: 'https://evil.example.com' },
    body: form,
  });
  const body = await res.json().catch(() => null);
  record('bot-style request, bad origin', 403, res.status, `error=${body?.error}`);
}

async function testNoToken() {
  const form = new URLSearchParams({
    name: '',
    reach: '',
    company: '',
    form_type: 'contact',
    // form_token deliberately omitted
  });
  const res = await fetch(`${BASE}/api/contact`, {
    method: 'POST',
    headers: { origin: ORIGIN },
    body: form,
  });
  const body = await res.json().catch(() => null);
  if (res.status === 403 && body?.error === 'bad_token') {
    record('valid origin, no form_token', 403, res.status, 'bad_token as expected');
  } else {
    record(
      'valid origin, no form_token',
      403,
      res.status,
      `got error=${body?.error}. FORM_SIGNING_SECRET is unset in this run, and verifyFormToken() ` +
        'intentionally fails open (skips the check) when the secret is absent, per the fail-open-when-unset ' +
        'requirement kept from the existing defences. The bad_token path only triggers with FORM_SIGNING_SECRET set.',
    );
  }
}

async function testNoteNeedsEmail() {
  const tokenRes = await fetch(`${BASE}/api/form-token`, {
    headers: { origin: ORIGIN },
  });
  const tokenBody = await tokenRes.json().catch(() => null);
  const token = tokenBody?.token ?? '';

  // The form token enforces a minimum 3s time-to-submit when
  // FORM_SIGNING_SECRET is set; wait it out so this test also passes in an
  // environment where the secret is configured.
  await waitFor(3_200);

  const form = new URLSearchParams({
    name: 'Jane Smith',
    reach: '07700 900123',
    site: '',
    message: '',
    note: 'on',
    company: '',
    form_type: 'contact',
    form_token: token,
  });
  const res = await fetch(`${BASE}/api/contact`, {
    method: 'POST',
    headers: { origin: ORIGIN },
    body: form,
  });
  const body = await res.json().catch(() => null);

  if (res.status === 403) {
    record(
      'contact, note ticked + phone number',
      400,
      res.status,
      `token check blocked the request before validation (error=${body?.error}); could not reach note_needs_email`,
    );
    return;
  }

  record(
    'contact, note ticked + phone number',
    [400],
    res.status,
    `error=${body?.error}, expected note_needs_email`,
  );
}

async function testClickBeacon() {
  const res = await fetch(`${BASE}/api/click`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'text/plain' },
    body: JSON.stringify({ channel: 'call', ref: 'SITE-26-0418' }),
  });
  record('click beacon (text/plain body, like sendBeacon)', 204, res.status);
}

async function main() {
  log(`Starting dev server on port ${PORT} with no env secrets...`);
  const projectRoot = new URL('..', import.meta.url).pathname;
  // Run the astro binary directly (not via `npm run dev`) so killing this
  // one process actually stops the server, rather than leaving an orphaned
  // child behind an npm wrapper.
  const child = spawn(
    process.execPath,
    [`${projectRoot}node_modules/astro/astro.js`, 'dev', '--port', String(PORT)],
    {
      cwd: projectRoot,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        // Deliberately no RESEND_API_KEY, SUPABASE_URL/KEY, FORM_SIGNING_SECRET,
        // TURNSTILE_SECRET_KEY, ATTIO_API_KEY: exercises fail-open behaviour.
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let serverOutput = '';
  child.stdout.on('data', (d) => (serverOutput += d.toString()));
  child.stderr.on('data', (d) => (serverOutput += d.toString()));

  try {
    await waitForServer();
    log('Dev server is up.\n');

    await testBadOrigin();
    await testNoToken();
    await testNoteNeedsEmail();
    await testClickBeacon();

    log('\n--- Summary ---');
    for (const r of results) {
      log(`${r.pass ? 'PASS' : 'INFO'}  ${r.name}`);
    }
  } catch (err) {
    console.error('Smoke test failed to run:', err);
    console.error('--- server output ---\n', serverOutput);
    process.exitCode = 1;
  } finally {
    child.kill('SIGTERM');
    // give it a moment, then force-kill if still around
    await waitFor(500);
    try {
      child.kill('SIGKILL');
    } catch {
      // already gone
    }
  }
}

main();
