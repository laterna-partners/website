// POST /api/note-signup — handles the take-home-note form.
// Two emails go out (best-effort, both are non-blocking):
//   1. To the requester — the option-agreement PDF attached, brief covering note.
//   2. To Hayri — lead notification, no attachment.
// The instant-download link on the page always works regardless of email outcome.
import type { APIRoute } from 'astro';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { getResend, NOTIFY_EMAIL, FROM_EMAIL } from '../../lib/resend';
import { getSupabase } from '../../lib/supabase';

export const prerender = false;

const PDF_FILENAME = 'Laterna - Option Agreements.pdf';

// The PDF is bundled into the serverless function via includeFiles in
// astro.config.mjs. Vercel preserves the project-relative path inside the
// function bundle, so we resolve it from process.cwd(). We try a couple of
// candidate locations in case the runtime cwd differs between environments.
function resolvePdfPath(): string | null {
  const candidates = [
    path.join(process.cwd(), 'public', 'notes', PDF_FILENAME),
    path.join(process.cwd(), '.vercel', 'output', 'static', 'notes', PDF_FILENAME),
    path.join('/var/task', 'public', 'notes', PDF_FILENAME),
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

  // ---- Email 1: PDF to the requester (best-effort) ------------------------
  // Read the bundled PDF from disk (see includeFiles in astro.config.mjs).
  if (resend) {
    try {
      const pdfPath = resolvePdfPath();
      if (!pdfPath) {
        throw new Error(`PDF not found. cwd=${process.cwd()}`);
      }
      console.log('[note-signup] using PDF at', pdfPath);
      const pdfBuffer = await readFile(pdfPath);

      const firstName = name.split(/\s+/)[0];
      const requesterSubject = 'The note on option agreements';
      const requesterBody = [
        `Hi ${firstName},`,
        '',
        'As promised, here is the short reference note on how option agreements work.',
        'It covers what an option agreement actually commits you to, what it does not,',
        'typical timelines, the kinds of questions worth asking, and where things can go wrong.',
        '',
        'Read it in your own time. If anything is unclear, or you want to talk through',
        'how it might apply to your own land, the direct line is +44 7471 127212 —',
        'weekdays, 09:00–18:00. You can also reply to this email.',
        '',
        'Best,',
        'Hayri Demirçapa',
        'Founder & Architect, Laterna+Partners',
      ].join('\n');

      await resend.emails.send({
        from: FROM_EMAIL,
        to: email,
        replyTo: NOTIFY_EMAIL,
        subject: requesterSubject,
        text: requesterBody,
        attachments: [
          {
            filename: PDF_FILENAME,
            content: pdfBuffer,
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
