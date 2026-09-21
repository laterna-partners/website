// POST /api/note-signup: handles the take-home-note (light gate) form.
// Sends the requester the note via Resend (template + signed download link,
// see sendNoteEmail in src/lib/resend.ts), persists the lead to Supabase,
// best-effort mirrors to Attio, and notifies Hayri. Returns the same
// download link so the page can offer "download it now" regardless of the
// email's outcome.
import type { APIRoute } from 'astro';
import { getResend, NOTIFY_EMAIL, FROM_EMAIL, sendNoteEmail } from '../../lib/resend';
import { getSupabase } from '../../lib/supabase';
import { upsertPersonFromEnquiry } from '../../lib/attio';
import {
  runFormGuard,
  validateName,
  validateEmail,
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

  if ((form.get('company') as string | null)?.trim()) {
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  const guard = await runFormGuard(request, form);
  if (!guard.ok) return guard.response;

  const rawName = ((form.get('name') as string) ?? '').trim();
  const rawEmail = ((form.get('email') as string) ?? '').trim();
  const rawRef = ((form.get('ref') as string) ?? '').trim();

  const name = validateName(rawName);
  if (!name) return jsonResponse(400, { ok: false, error: 'invalid_name' });

  const email = validateEmail(rawEmail);
  if (!email) return jsonResponse(400, { ok: false, error: 'invalid_email' });

  // The form's `ref` field is a hidden echo of the arrival ref (see
  // TakeHomeNote.astro), not an independently editable value like contact's
  // `site` field, so it's stored in the existing arrival_ref column rather
  // than a new one (see the migration notes for why no `ref` column was added).
  const submittedRef = rawRef ? rawRef.toUpperCase() : null;
  const ref = submittedRef ?? locals.ref ?? null;

  const supabase = getSupabase();
  let supabaseOk: boolean | null = null;
  if (supabase) {
    const { error } = await supabase.from('contact_submissions').insert({
      form_type: 'note-signup',
      name,
      contact_method: email,
      arrival_ref: ref,
    });
    supabaseOk = !error;
    if (error) console.error('[note-signup] supabase insert failed', error.message);
  }

  // Best-effort CRM mirror, after the Supabase insert, never blocks the
  // response beyond attio.ts's own fixed timeout.
  await upsertPersonFromEnquiry({
    name,
    email,
    phone: null,
    ref,
    message: null,
    source: 'note-signup',
  });

  // ---- Email 1: the note, to the requester (best-effort) ------------------
  const noteResult = await sendNoteEmail({ toEmail: email, name, request });

  // ---- Email 2: notification to Hayri -------------------------------------
  const resend = getResend();
  const subject = `Note signup: ${name}`;
  const body = [
    `Name: ${name}`,
    `Email: ${email}`,
    ref && `Arrived via: ${ref}`,
    '',
    'They requested the option-agreement explainer PDF.',
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

  return jsonResponse(200, { ok: true, download_url: noteResult.downloadUrl });
};
