// Signed, expiring download tokens for the option-agreement note PDF
// (GET /api/note/[token]). No state is stored: everything needed to verify
// the link is in the token itself, HMAC-signed with FORM_SIGNING_SECRET so it
// can't be forged or its expiry edited.
//
// Token shape: base64url(payload) + '.' + base64url(HMAC-SHA256(payload)),
// where payload is the literal string `note:<email>:<expiryMs>`.
//
// Mirrors form-guard.ts's fail-open posture: if FORM_SIGNING_SECRET is unset,
// tokens are still issued and verified (signature check skipped) rather than
// breaking the note-signup flow, but this is logged loudly so it gets fixed
// before relying on it in production.
import { createHmac, timingSafeEqual } from 'node:crypto';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function issueDownloadToken(email: string): string {
  const secret = process.env.FORM_SIGNING_SECRET;
  if (!secret) {
    console.error('[download-token] FORM_SIGNING_SECRET not set, issuing an unverified token');
  }
  const expiry = Date.now() + SEVEN_DAYS_MS;
  const payload = `note:${email}:${expiry}`;
  const encodedPayload = Buffer.from(payload, 'utf8').toString('base64url');
  const signature = sign(payload, secret ?? '');
  return `${encodedPayload}.${signature}`;
}

export interface DownloadTokenCheck {
  ok: boolean;
  email: string | null;
}

export function verifyDownloadToken(token: string): DownloadTokenCheck {
  const dot = token.indexOf('.');
  if (dot < 1) return { ok: false, email: null };

  const encodedPayload = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  let payload: string;
  try {
    payload = Buffer.from(encodedPayload, 'base64url').toString('utf8');
  } catch {
    return { ok: false, email: null };
  }

  const parts = payload.split(':');
  if (parts.length !== 3 || parts[0] !== 'note') return { ok: false, email: null };
  const [, email, expiryRaw] = parts;
  const expiry = Number(expiryRaw);
  if (!email || !Number.isFinite(expiry)) return { ok: false, email: null };

  const secret = process.env.FORM_SIGNING_SECRET;
  if (secret) {
    const expected = sign(payload, secret);
    const bufExpected = Buffer.from(expected, 'utf8');
    const bufActual = Buffer.from(signature, 'utf8');
    if (bufExpected.length !== bufActual.length || !timingSafeEqual(bufExpected, bufActual)) {
      return { ok: false, email: null };
    }
  } else {
    console.error('[download-token] FORM_SIGNING_SECRET not set, skipping signature check');
  }

  if (Date.now() > expiry) return { ok: false, email: null };

  return { ok: true, email };
}
