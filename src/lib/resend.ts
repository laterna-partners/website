// Resend client: wraps the SDK so callers don't have to thread env checks.
// Returns null if not configured (early dev mode), which lets callers fall back
// to logging the submission so we never lose a lead during setup.
import { Resend } from 'resend';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { issueDownloadToken } from './download-token';

let _client: Resend | null | undefined;

export function getResend(): Resend | null {
  if (_client !== undefined) return _client;

  // Runtime env first (how it's actually set on Vercel), import.meta.env as a fallback for local dev.
  const key = process.env.RESEND_API_KEY ?? import.meta.env.RESEND_API_KEY;
  if (!key) {
    console.warn('[resend] RESEND_API_KEY not set, emails will be logged only');
    _client = null;
    return null;
  }

  _client = new Resend(key);
  return _client;
}

export const NOTIFY_EMAIL = import.meta.env.NOTIFY_EMAIL ?? 'hayri@laterna.partners';
export const FROM_EMAIL = import.meta.env.FROM_EMAIL ?? 'Hayri Demirçapa <hayri@laterna.partners>';

// ---------------------------------------------------------------------------
// Take-home note email, shared by POST /api/note-signup and POST /api/contact
// (when its "also email me the note" tick is set). The PDF is bundled into
// the serverless function by astro.config.mjs (includeFiles) so it can be
// read from disk at runtime when the attachment path is switched on below.
// ---------------------------------------------------------------------------

const NOTE_PDF_FILENAME = 'Laterna - Option Agreements.pdf';
const NOTE_PDF_RELATIVE = path.join('src', 'assets', 'notes', NOTE_PDF_FILENAME);

// Resend template that owns the requester email body: subject, from,
// reply-to, HTML and preview text all live in the template. We only pass
// variables (and, when NOTE_ATTACH_PDF=1, an attachment) at send time.
// Dashboard: https://resend.com/templates/a0f51d6a-b890-489e-ad4c-f00c09cabdb9
const REQUESTER_TEMPLATE_ID = 'a0f51d6a-b890-489e-ad4c-f00c09cabdb9';

// Set NOTE_ATTACH_PDF=1 to go back to attaching the PDF directly instead of
// relying only on the downloadUrl variable. Keep this switch until the
// Resend template body is edited in the dashboard to use {{downloadUrl}}.
function attachPdfEnabled(): boolean {
  return process.env.NOTE_ATTACH_PDF === '1';
}

function resolveBundledNotePdf(): string | null {
  const candidates = [
    path.join(process.cwd(), NOTE_PDF_RELATIVE),
    path.join(process.cwd(), '.vercel', 'output', 'static', NOTE_PDF_RELATIVE),
    path.join('/var/task', NOTE_PDF_RELATIVE),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

// Public origin of the site for links that leave the page (the download link
// in the email and on the success panel). Behind Vercel's proxy request.url
// reports the internal host (it produced https://localhost/... in
// production), so prefer the forwarded host header, then the canonical site
// from astro.config.mjs, and fall back to the request only in local dev.
export function publicOrigin(request: Request): string {
  const forwardedHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const forwardedProto = request.headers.get('x-forwarded-proto') ?? 'https';
  if (forwardedHost && !/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(forwardedHost)) {
    return `${forwardedProto}://${forwardedHost}`;
  }
  const site = import.meta.env.SITE;
  if (site && !/localhost/i.test(site)) return site.replace(/\/$/, '');
  return new URL(request.url).origin;
}

// Builds the seven-day signed link to GET /api/note/[token] for the given
// email, on the public origin so it works the same in local dev, preview and
// production.
export function buildNoteDownloadUrl(email: string, request: Request): string {
  const token = issueDownloadToken(email);
  return `${publicOrigin(request)}/api/note/${token}`;
}

export interface SendNoteEmailInput {
  toEmail: string;
  name: string;
  request: Request;
}

export interface SendNoteEmailResult {
  ok: boolean;
  downloadUrl: string;
}

// Sends the requester-facing "note on option agreements" email through the
// Resend template above, passing a signed downloadUrl variable alongside
// firstName. Best-effort: never throws, and always returns the downloadUrl
// so the caller can still offer an instant download even when the email
// send fails.
export async function sendNoteEmail(input: SendNoteEmailInput): Promise<SendNoteEmailResult> {
  const downloadUrl = buildNoteDownloadUrl(input.toEmail, input.request);
  const resend = getResend();
  if (!resend) {
    console.log('[resend] would email note to', input.toEmail, downloadUrl);
    return { ok: false, downloadUrl };
  }

  const firstName = input.name.split(/\s+/)[0];

  try {
    const message: Record<string, unknown> = {
      from: FROM_EMAIL,
      to: input.toEmail,
      replyTo: NOTIFY_EMAIL,
      // SDK v6 accepts `template: { id, variables }`. When set, the
      // template provides subject, html, text and preview text.
      template: { id: REQUESTER_TEMPLATE_ID, variables: { firstName, downloadUrl } },
    };

    if (attachPdfEnabled()) {
      const pdfPath = resolveBundledNotePdf();
      if (pdfPath) {
        const pdfBuffer = await readFile(pdfPath);
        message.attachments = [
          {
            filename: NOTE_PDF_FILENAME,
            // Resend's REST API expects base64-encoded content as a string.
            content: pdfBuffer.toString('base64'),
            contentType: 'application/pdf',
          },
        ];
      } else {
        console.error('[resend] NOTE_ATTACH_PDF=1 but PDF not found. cwd=', process.cwd());
      }
    }

    // The 'as never' is because the SDK's send() type may not yet surface
    // the template field publicly; the underlying REST API accepts it.
    await resend.emails.send(message as never);
    return { ok: true, downloadUrl };
  } catch (err) {
    console.error('[resend] note email failed', err);
    return { ok: false, downloadUrl };
  }
}
