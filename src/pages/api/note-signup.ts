// POST /api/note-signup: handles the take-home-note form.
// Two emails go out (best-effort, both are non-blocking):
//   1. To the requester: PDF attachment + branded HTML body rendered from a
//      Resend template (id below). Edit body/subject/preview text in the
//      Resend dashboard, no code change needed.
//   2. To Hayri: plain-text lead notification, no attachment.
// The instant-download link on the page always works regardless of email outcome.
import type { APIRoute } from 'astro';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { getResend, NOTIFY_EMAIL, FROM_EMAIL } from '../../lib/resend';
import { getSupabase } from '../../lib/supabase';

export const prerender = false;

const PDF_FILENAME = 'Laterna - Option Agreements.pdf';

// Resend template that owns the requester email body. Subject, From, Reply-To,
// HTML, and preview text all live in the template; we only pass the PDF
// attachment and variables at send time.
// Dashboard: https://resend.com/templates/a0f51d6a-b890-489e-ad4c-f00c09cabdb9
const REQUESTER_TEMPLATE_ID = 'a0f51d6a-b890-489e-ad4c-f00c09cabdb9';

// The PDF is bundled into the serverless function via includeFiles in
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
  // Body comes from the Resend template; we attach the PDF inline at send time.
  if (resend) {
    try {
      const pdfPath = resolveBundledFile(`notes/${PDF_FILENAME}`);
      if (!pdfPath) throw new Error(`PDF not found. cwd=${process.cwd()}`);
      const pdfBuffer = await readFile(pdfPath);

      const firstName = name.split(/\s+/)[0];

      // SDK v6 accepts `template: { id, variables }`. When set, the template
      // provides subject, html, text, preview text. We still pass from/to/
      // replyTo and attachments at send time.
      // The 'as never' is because the SDK's send() type may not yet surface
      // the template field publicly; the underlying API accepts it.
      await resend.emails.send({
        from: FROM_EMAIL,
        to: email,
        replyTo: NOTIFY_EMAIL,
        template: { id: REQUESTER_TEMPLATE_ID, variables: { firstName } },
        attachments: [
          {
            filename: PDF_FILENAME,
            // Resend's REST API expects base64-encoded content as a string.
            content: pdfBuffer.toString('base64'),
            contentType: 'application/pdf',
          },
        ],
      } as never);
    } catch (err) {
      // Don't fail the request. The instant-download link on the page still works.
      console.error('[note-signup] requester email failed', err);
    }
  }

  // ---- Email 2: notification to Hayri -------------------------------------
  const subject = `Note signup: ${name}`;
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
