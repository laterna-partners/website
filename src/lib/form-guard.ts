// Shared anti-bot and validation helpers for the two public forms on
// /landowners (note-signup and contact). Everything here is best-effort by
// design: a missing env var degrades a check rather than blocking real leads,
// but logs loudly so it gets noticed before too many days pass.
//
// Secrets (TURNSTILE_SECRET_KEY, FORM_SIGNING_SECRET) are read from
// process.env, not import.meta.env, because they are set at runtime on
// Vercel rather than baked in at build time.
import { createHmac, timingSafeEqual } from 'node:crypto';

// ---------------------------------------------------------------------------
// JSON response helper
// ---------------------------------------------------------------------------

export function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Origin allowlist
// ---------------------------------------------------------------------------
// Astro's security.checkOrigin is left off in astro.config.mjs (see the
// comment there) because it misfired on legitimate multipart POSTs behind
// Vercel's proxy. This is the replacement: a plain allowlist of hosts we
// expect real form submissions to come from.

const ALLOWED_EXACT_HOSTS = new Set(['laterna.partners', 'www.laterna.partners']);

function isAllowedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (ALLOWED_EXACT_HOSTS.has(host)) return true;
  if (host === 'localhost') return true; // any port: hostname excludes the port
  if (host.endsWith('.vercel.app')) return true; // preview deployments
  return false;
}

// Reads Origin, falling back to Referer. A request with neither header is
// rejected, as is one whose header doesn't parse as a URL.
export function isAllowedOrigin(request: Request): boolean {
  const header = request.headers.get('origin') ?? request.headers.get('referer');
  if (!header) return false;
  try {
    return isAllowedHost(new URL(header).hostname);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Client IP
// ---------------------------------------------------------------------------

export function getClientIp(request: Request): string {
  // x-real-ip is set by Vercel's own edge network and isn't client-controlled,
  // so it's trusted first. x-forwarded-for can carry a chain the client
  // supplied part of, so it's only a fallback.
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first) return first;
  }
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Per-IP rate limit
// ---------------------------------------------------------------------------
// Module-level, in-memory, per serverless instance. Vercel can spin up several
// instances and recycles them on redeploys or after idle, so this is a soft
// limit only, not a hard guarantee across all traffic. It still stops the
// common case: one instance getting hammered in a burst.

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_PER_WINDOW = 5;

const submissionsByIp = new Map<string, number[]>();

export function checkRateLimit(ip: string, max: number = RATE_LIMIT_MAX_PER_WINDOW): boolean {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;

  const recent = (submissionsByIp.get(ip) ?? []).filter((t) => t > cutoff);
  const allowed = recent.length < max;
  if (allowed) recent.push(now);
  submissionsByIp.set(ip, recent);

  // Occasionally sweep the whole map so IPs that stop submitting don't sit in
  // memory for the lifetime of the instance. Cheap enough at this volume.
  if (Math.random() < 0.05) {
    for (const [key, times] of submissionsByIp) {
      const kept = times.filter((t) => t > cutoff);
      if (kept.length === 0) submissionsByIp.delete(key);
      else submissionsByIp.set(key, kept);
    }
  }

  return allowed;
}

// ---------------------------------------------------------------------------
// Form token: proof the page was actually loaded, and a minimum time to
// submit. Issued by GET /api/form-token, carried in a hidden `form_token`
// input, verified here.
// ---------------------------------------------------------------------------

const FORM_TOKEN_MIN_AGE_MS = 3_000;
const FORM_TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function signFormToken(issuedAtMs: number, secret: string): string {
  return createHmac('sha256', secret).update(String(issuedAtMs)).digest('hex');
}

// Issues a fresh token. If FORM_SIGNING_SECRET isn't set, still returns a
// well-formed token (signed with an empty key) so the client flow keeps
// working; verifyFormToken() skips the signature check in that case too.
export function issueFormToken(): string {
  const secret = process.env.FORM_SIGNING_SECRET;
  if (!secret) {
    console.error('[form-guard] FORM_SIGNING_SECRET not set, issuing an unverified token');
  }
  const issuedAtMs = Date.now();
  return `${issuedAtMs}.${signFormToken(issuedAtMs, secret ?? '')}`;
}

function parseFormToken(token: string | null): { issuedAtMs: number; signature: string } | null {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot < 1) return null;
  const issuedAtMs = Number(token.slice(0, dot));
  const signature = token.slice(dot + 1);
  if (!Number.isFinite(issuedAtMs) || !signature) return null;
  return { issuedAtMs, signature };
}

function hexEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export interface FormTokenCheck {
  ok: boolean;
  // Age in whole seconds when the token could be parsed, even if the check
  // was skipped or failed, so diagnostics can still report it. Null when
  // there was no usable token to measure at all.
  ageSeconds: number | null;
}

export function verifyFormToken(token: string | null): FormTokenCheck {
  const parsed = parseFormToken(token);
  const ageSeconds = parsed ? Math.round((Date.now() - parsed.issuedAtMs) / 1000) : null;

  const secret = process.env.FORM_SIGNING_SECRET;
  if (!secret) {
    console.error('[form-guard] FORM_SIGNING_SECRET not set, skipping form token check');
    return { ok: true, ageSeconds };
  }

  if (!parsed) return { ok: false, ageSeconds: null };

  const expected = signFormToken(parsed.issuedAtMs, secret);
  if (!hexEqual(expected, parsed.signature)) return { ok: false, ageSeconds };

  const ageMs = Date.now() - parsed.issuedAtMs;
  if (ageMs < FORM_TOKEN_MIN_AGE_MS || ageMs > FORM_TOKEN_MAX_AGE_MS) {
    return { ok: false, ageSeconds };
  }

  return { ok: true, ageSeconds };
}

// ---------------------------------------------------------------------------
// Cloudflare Turnstile
// ---------------------------------------------------------------------------

export type TurnstileOutcome = 'pass' | 'fail' | 'skipped';

export async function verifyTurnstile(token: string | null, remoteIp: string): Promise<TurnstileOutcome> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    console.error('[form-guard] TURNSTILE_SECRET_KEY not set, skipping Turnstile');
    return 'skipped';
  }

  if (!token) return 'fail';

  try {
    const body = new URLSearchParams({ secret, response: token, remoteip: remoteIp });
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) return 'fail';
    const data = (await res.json()) as { success?: boolean };
    return data.success ? 'pass' : 'fail';
  } catch (err) {
    console.error('[form-guard] Turnstile siteverify request failed', err);
    return 'fail';
  }
}

// ---------------------------------------------------------------------------
// Combined guard: origin, rate limit, form token, Turnstile.
// Runs after the honeypot check (kept in each route) and before field
// validation. Returns either the context each route needs for its
// diagnostics email, or a ready-to-return failure Response.
// ---------------------------------------------------------------------------

export interface GuardOk {
  ok: true;
  ip: string;
  turnstileResult: TurnstileOutcome;
  tokenAgeSeconds: number | null;
}
export interface GuardFail {
  ok: false;
  response: Response;
}
export type GuardResult = GuardOk | GuardFail;

export async function runFormGuard(request: Request, form: FormData): Promise<GuardResult> {
  if (!isAllowedOrigin(request)) {
    return { ok: false, response: jsonResponse(403, { ok: false, error: 'bad_origin' }) };
  }

  const ip = getClientIp(request);

  if (!checkRateLimit(ip)) {
    return { ok: false, response: jsonResponse(429, { ok: false, error: 'rate_limited' }) };
  }

  const tokenCheck = verifyFormToken((form.get('form_token') as string | null) ?? null);
  if (!tokenCheck.ok) {
    return { ok: false, response: jsonResponse(403, { ok: false, error: 'bad_token' }) };
  }

  const turnstileToken = (form.get('cf-turnstile-response') as string | null) ?? null;
  const turnstileResult = await verifyTurnstile(turnstileToken, ip);
  if (turnstileResult === 'fail') {
    return { ok: false, response: jsonResponse(403, { ok: false, error: 'verification_failed' }) };
  }

  return { ok: true, ip, turnstileResult, tokenAgeSeconds: tokenCheck.ageSeconds };
}

// ---------------------------------------------------------------------------
// Field validation
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (!email || email.length > 254) return null;
  if (!EMAIL_RE.test(email)) return null;
  return email;
}

export function validateName(raw: string): string | null {
  const name = raw.trim();
  if (name.length < 2 || name.length > 100) return null;
  return name;
}

// Digits, plus, brackets, hyphens. Spaces are stripped before the length check.
const PHONE_RE = /^[0-9+()-]{7,20}$/;

export function validatePhone(raw: string): string | null {
  const phone = raw.replace(/\s+/g, '');
  if (!PHONE_RE.test(phone)) return null;
  return phone;
}

export interface ContactCheck {
  type: 'email' | 'phone';
  value: string;
}

// The contact route's "a way to reach you" field can be either. If it looks
// like an email (contains "@"), validate it as one; otherwise treat it as a
// phone number.
export function validateContact(raw: string): ContactCheck | null {
  const trimmed = raw.trim();
  if (trimmed.includes('@')) {
    const email = validateEmail(trimmed);
    return email ? { type: 'email', value: email } : null;
  }
  const phone = validatePhone(trimmed);
  return phone ? { type: 'phone', value: phone } : null;
}

// ---------------------------------------------------------------------------
// Diagnostics appended to the notification email sent to Hayri. Never used
// in the requester-facing email.
// ---------------------------------------------------------------------------

function getRequestGeo(request: Request): { country: string; city: string } {
  const country = request.headers.get('x-vercel-ip-country') ?? 'unknown';
  const rawCity = request.headers.get('x-vercel-ip-city');
  let city = 'unknown';
  if (rawCity) {
    try {
      city = decodeURIComponent(rawCity);
    } catch {
      city = rawCity;
    }
  }
  return { country, city };
}

export interface DiagnosticsInput {
  request: Request;
  ip: string;
  turnstileResult: TurnstileOutcome | 'n/a';
  tokenAgeSeconds: number | null;
  // null: Supabase wasn't configured, so no insert was attempted.
  supabaseOk: boolean | null;
}

export function buildDiagnosticsBlock(input: DiagnosticsInput): string {
  const { country, city } = getRequestGeo(input.request);
  const userAgent = input.request.headers.get('user-agent') ?? 'unknown';
  const supabaseStatus =
    input.supabaseOk === null ? 'not attempted' : input.supabaseOk ? 'ok' : 'failed';
  const tokenAge = input.tokenAgeSeconds === null ? 'missing' : `${input.tokenAgeSeconds}s`;

  return [
    'Diagnostics',
    `IP: ${input.ip}`,
    `Country: ${country}`,
    `City: ${city}`,
    `User agent: ${userAgent}`,
    `Turnstile: ${input.turnstileResult}`,
    `Form token age: ${tokenAge}`,
    `Supabase insert: ${supabaseStatus}`,
  ].join('\n');
}
