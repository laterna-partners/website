// Resend client — wraps the SDK so callers don't have to thread env checks.
// Returns null if not configured (early dev mode), which lets callers fall back
// to logging the submission so we never lose a lead during setup.
import { Resend } from 'resend';

let _client: Resend | null | undefined;

export function getResend(): Resend | null {
  if (_client !== undefined) return _client;

  const key = import.meta.env.RESEND_API_KEY;
  if (!key) {
    console.warn('[resend] RESEND_API_KEY not set — emails will be logged only');
    _client = null;
    return null;
  }

  _client = new Resend(key);
  return _client;
}

export const NOTIFY_EMAIL = import.meta.env.NOTIFY_EMAIL ?? 'hayri@laterna.partners';
export const FROM_EMAIL = import.meta.env.FROM_EMAIL ?? 'Laterna+Partners <onboarding@resend.dev>';
