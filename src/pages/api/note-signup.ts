// POST /api/note-signup — handles the take-home-note form.
// Two emails go out (best-effort, both are non-blocking):
//   1. To the requester — branded HTML email with PDF attached and inline-CID
//      logo in the signature.
//   2. To Hayri — plain-text lead notification, no attachment.
// The instant-download link on the page always works regardless of email outcome.
import type { APIRoute } from 'astro';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { getResend, NOTIFY_EMAIL, FROM_EMAIL } from '../../lib/resend';
import { getSupabase } from '../../lib/supabase';

export const prerender = false;

const PDF_FILENAME = 'Laterna - Option Agreements.pdf';
const LOGO_FILENAME = 'laterna-logo-full.png';
const LOGO_CID = 'laterna-logo';

// Assets are bundled into the serverless function via includeFiles in
// astro.config.mjs. Vercel preserves the project-relative path inside the
// function bundle, so we resolve from process.cwd(). We try a couple of
// candidate locations in case the runtime cwd differs between environments.
function resolveBundledFile(relativeFromPublic: string): string | null {
  const candidates = [
    path.join(process.cwd(), 'public', relativeFromPublic),
    path.join(process.cwd(), '.vercel', 'output', 'static', relativeFromPublic),
    path.join('/var/task', 'public', relativeFromPublic),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderRequesterEmail(firstName: string): { html: string; text: string } {
  const safeFirst = escapeHtml(firstName);

  // Plain-text fallback for clients that don't render HTML.
  const text = [
    `Hi ${firstName},`,
    '',
    'As promised, here is the short reference note on how option agreements work.',
    'It covers what an option agreement actually commits you to, what it does not,',
    'typical timelines, the kinds of questions worth asking, and where things can',
    'go wrong.',
    '',
    'Read it in your own time. If anything is unclear, or you want to talk through',
    'how it might apply to your own land, the direct line is +44 7471 127212 —',
    'weekdays, 09:00–18:00. You can also reply to this email.',
    '',
    'Best,',
    '',
    'Hayri Demirçapa',
    'Founder | Architect',
    '',
    't  +44 7471 127212',
    '',
    'laterna.partners',
  ].join('\n');

  // HTML body. Inline styles only — email clients strip <style> tags
  // inconsistently. Table-based outer layout for Outlook safety; the
  // signature uses a <table> so border-top renders cleanly everywhere.
  // Colours match the site tokens (ink #4A4A4A, accent #92C1E9, mute #888).
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>The note on option agreements</title>
</head>
<body style="margin:0;padding:0;background:#FFFFFF;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
          <tr>
            <td style="padding:0 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#4A4A4A;font-size:16px;line-height:1.65;">
              <p style="margin:0 0 20px;">Hi ${safeFirst},</p>
              <p style="margin:0 0 20px;">As promised, here is the short reference note on how option agreements work. It covers what an option agreement actually commits you to, what it does not, typical timelines, the kinds of questions worth asking, and where things can go wrong.</p>
              <p style="margin:0 0 20px;">Read it in your own time. If anything is unclear, or you want to talk through how it might apply to your own land, the direct line is <a href="tel:+447471127212" style="color:#4A4A4A;text-decoration:underline;">+44 7471 127212</a> &mdash; weekdays, 09:00&ndash;18:00. You can also reply to this email.</p>
              <p style="margin:0;">Best,</p>

              <!-- Signature: vertical letterhead. One element per line,
                   logo as the brand anchor in the middle, t: prefix
                   following architecture-firm convention. No top rule so
                   the logo carries the visual weight. -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:44px;">
                <tr>
                  <td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
                    <p style="margin:0;font-size:17px;color:#2A2A2A;font-weight:600;letter-spacing:-0.005em;line-height:1.3;">Hayri Demirçapa</p>
                    <p style="margin:6px 0 0;font-size:14px;color:#888888;font-weight:400;line-height:1.5;">Founder&nbsp;&nbsp;|&nbsp;&nbsp;Architect</p>

                    <p style="margin:36px 0;">
                      <img src="cid:${LOGO_CID}" alt="Laterna+Partners" width="150" style="display:block;width:150px;height:auto;border:0;outline:none;text-decoration:none;">
                    </p>

                    <p style="margin:0;font-size:14px;color:#4A4A4A;line-height:1.6;">
                      <span style="color:#AAAAAA;">t</span>&nbsp;&nbsp;<a href="tel:+447471127212" style="color:#4A4A4A;text-decoration:none;">+44 7471 127212</a>
                    </p>

                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="left" style="margin:22px 0 14px;">
                      <tr>
                        <td style="width:28px;border-top:1px solid #D0D0D0;font-size:0;line-height:0;height:1px;">&nbsp;</td>
                      </tr>
                    </table>

                    <p style="margin:0;font-size:14px;color:#4A4A4A;line-height:1.6;">
                      <a href="https://laterna.partners" style="color:#4A4A4A;text-decoration:underline;">laterna.partners</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { html, text };
}

export const POST: APIRoute = async ({ request, locals }) => {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response(JSON.stringify({ error: 'Bad form data' }), { status: 400 });
  }

  if ((form.get('company') as string | null)?.trim()) {
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  const name = ((form.get('name') as string) ?? '').trim();
  const email = ((form.get('email') as string) ?? '').trim();
  const phone = ((form.get('phone') as string) ?? '').trim();

  if (!name || !email) {
    return new Response(JSON.stringify({ error: 'Name and email required' }), { status: 400 });
  }

  const supabase = getSupabase();
  if (supabase) {
    const { error } = await supabase.from('contact_submissions').insert({
      form_type: 'note-signup',
      name,
      contact_method: email,
      phone: phone || null,
      arrival_ref: locals.ref ?? null,
    });
    if (error) console.error('[note-signup] supabase insert failed', error.message);
  }

  const resend = getResend();

  // ---- Email 1: PDF + branded signature to the requester (best-effort) ----
  if (resend) {
    try {
      const pdfPath = resolveBundledFile(`notes/${PDF_FILENAME}`);
      const logoPath = resolveBundledFile(`assets/${LOGO_FILENAME}`);
      if (!pdfPath) throw new Error(`PDF not found. cwd=${process.cwd()}`);
      if (!logoPath) throw new Error(`Logo not found. cwd=${process.cwd()}`);
      console.log('[note-signup] using PDF at', pdfPath, '| logo at', logoPath);

      const [pdfBuffer, logoBuffer] = await Promise.all([
        readFile(pdfPath),
        readFile(logoPath),
      ]);

      const firstName = name.split(/\s+/)[0];
      const { html, text } = renderRequesterEmail(firstName);

      await resend.emails.send({
        from: FROM_EMAIL,
        to: email,
        replyTo: NOTIFY_EMAIL,
        subject: 'The note on option agreements',
        html,
        text,
        attachments: [
          {
            filename: PDF_FILENAME,
            // Resend's REST API expects base64-encoded content as a string.
            // A raw Buffer gets JSON-serialised to {type:'Buffer',data:[...]}
            // which the API can't decode — attachment ends up corrupt or missing.
            content: pdfBuffer.toString('base64'),
            contentType: 'application/pdf',
          },
          {
            filename: LOGO_FILENAME,
            content: logoBuffer.toString('base64'),
            contentType: 'image/png',
            // Resend v6 renamed inlineContentId -> contentId (API field
            // content_id). Setting this flips the attachment to inline
            // disposition so the cid:laterna-logo reference resolves.
            contentId: LOGO_CID,
          },
        ],
      });
    } catch (err) {
      // Don't fail the request — the instant-download link on the page still works.
      console.error('[note-signup] requester email failed', err);
    }
  }

  // ---- Email 2: notification to Hayri -------------------------------------
  const subject = `Note signup — ${name}`;
  const body = [
    `Name: ${name}`,
    `Email: ${email}`,
    phone && `Phone: ${phone}`,
    locals.ref && `Arrived via: ${locals.ref}`,
    '',
    'They requested the option-agreement explainer PDF.',
  ].filter(Boolean).join('\n');

  if (resend) {
    try {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: NOTIFY_EMAIL,
        replyTo: email,
        subject,
        text: body,
      });
    } catch (err) {
      console.error('[note-signup] notification email failed', err);
    }
  } else {
    console.log('[note-signup] would email:', subject, '\n', body);
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
