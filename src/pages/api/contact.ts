// POST /api/contact: the merged contact form (name, reach, site reference,
// message, "also email me the note" tick). Emails Hayri via Resend, persists
// to Supabase, and best-effort mirrors to Attio. Returns 200 JSON on
// success, 4xx on failure; the client-side script swaps to a thank-you state
// when it sees 200.
import type { APIRoute } from 'astro';
import { getResend, NOTIFY_EMAIL, FROM_EMAIL, sendNoteEmail } from '../../lib/resend';
import { getSupabase } from '../../lib/supabase';
import { upsertPersonFromEnquiry } from '../../lib/attio';
import {
  runFormGuard,
  validateName,
  validateContact,
  buildDiagnosticsBlock,
  jsonResponse,
} from '../../lib/form-guard';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response(JSON.stringify({ error: 'Bad form data' }), { status: 400 });
  }

  // Honeypot: silently accept and discard
  if ((form.get('company') as string | null)?.trim()) {
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  const guard = await runFormGuard(request, form);
  if (!guard.ok) return guard.response;

  const rawName = ((form.get('name') as string) ?? '').trim();
  const rawReach = ((form.get('reach') as string) ?? '').trim();
  const rawSite = ((form.get('site') as string) ?? '').trim();
  const message = ((form.get('message') as string) ?? '').trim();
  const noteRequested = ((form.get('note') as string | null) ?? '').trim() === 'on';

  const name = validateName(rawName);
  if (!name) return jsonResponse(400, { ok: false, error: 'invalid_name' });

  const reachCheck = validateContact(rawReach);
  if (!reachCheck) return jsonResponse(400, { ok: false, error: 'invalid_contact' });
  const reach = reachCheck.value;

  if (noteRequested && reachCheck.type !== 'email') {
    return jsonResponse(400, { ok: false, error: 'note_needs_email' });
  }

  const site = rawSite ? rawSite.toUpperCase() : null;

  // Best-effort persist
  const supabase = getSupabase();
  let supabaseOk: boolean | null = null;
  if (supabase) {
    const { error } = await supabase.from('contact_submissions').insert({
      form_type: 'contact',
      name,
      contact_method: reach,
      site_ref: site,
      message: message || null,
      arrival_ref: locals.ref ?? null,
      note_requested: noteRequested,
    });
    supabaseOk = !error;
    if (error) console.error('[contact] supabase insert failed', error.message);
  }

  // Best-effort CRM mirror, after the Supabase insert, never blocks the
  // response beyond attio.ts's own fixed timeout.
  await upsertPersonFromEnquiry({
    name,
    email: reachCheck.type === 'email' ? reach : null,
    phone: reachCheck.type === 'phone' ? reach : null,
    ref: site ?? locals.ref ?? null,
    message: message || null,
    source: 'contact',
  });

  // When the note was requested and we have an email to send it to, send it
  // exactly as note-signup.ts does, via the shared helper.
  if (noteRequested && reachCheck.type === 'email') {
    await sendNoteEmail({ toEmail: reach, name, request });
  }

  // Email Hayri
  const resend = getResend();
  const subject = `Laterna enquiry: ${name}`;
  const body = [
    `Name: ${name}`,
    `Reach: ${reach}`,
    site && `Site reference: ${site}`,
    locals.ref && `Arrived via: ${locals.ref}`,
    `Note requested: ${noteRequested ? 'yes' : 'no'}`,
    '',
    message ? `Message:\n${message}` : '(no message)',
    '',
    buildDiagnosticsBlock({
      request,
      ip: guard.ip,
      turnstileResult: guard.turnstileResult,
      tokenAgeSeconds: guard.tokenAgeSeconds,
      supabaseOk,
    }),
  ].filter(Boolean).join('\n');

  if (resend) {
    try {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: NOTIFY_EMAIL,
        replyTo: reachCheck.type === 'email' ? reach : undefined,
        subject,
        text: body,
      });
    } catch (err) {
      console.error('[contact] resend failed', err);
      // Don't fail the request; we already saved to Supabase
    }
  } else {
    console.log('[contact] would email:', subject, '\n', body);
  }

  return jsonResponse(200, { ok: true, note_requested: noteRequested });
};
