// POST /api/contact: handles the "Write something here instead" form
// from the Contact section. Emails Hayri via Resend, persists to Supabase.
// Returns 200 with JSON on success, 400/500 on failure. The client-side
// script swaps to a thank-you state when it sees 200.
import type { APIRoute } from 'astro';
import { getResend, NOTIFY_EMAIL, FROM_EMAIL } from '../../lib/resend';
import { getSupabase } from '../../lib/supabase';
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
  const rawContact = ((form.get('contact') as string) ?? '').trim();
  const site = ((form.get('site') as string) ?? '').trim();
  const message = ((form.get('message') as string) ?? '').trim();

  if (!rawName || !rawContact) {
    return jsonResponse(400, { ok: false, error: 'Name and contact required' });
  }

  const name = validateName(rawName);
  if (!name) return jsonResponse(400, { ok: false, error: 'invalid_name' });

  const contactCheck = validateContact(rawContact);
  if (!contactCheck) return jsonResponse(400, { ok: false, error: 'invalid_contact' });
  const contact = contactCheck.value;

  // Best-effort persist
  const supabase = getSupabase();
  let supabaseOk: boolean | null = null;
  if (supabase) {
    const { error } = await supabase.from('contact_submissions').insert({
      form_type: 'contact',
      name,
      contact_method: contact,
      site_ref: site || null,
      message: message || null,
      arrival_ref: locals.ref ?? null,
    });
    supabaseOk = !error;
    if (error) console.error('[contact] supabase insert failed', error.message);
  }

  // Email Hayri
  const resend = getResend();
  const subject = `Laterna enquiry: ${name}`;
  const body = [
    `Name: ${name}`,
    `Reach: ${contact}`,
    site && `Site reference: ${site}`,
    locals.ref && `Arrived via: ${locals.ref}`,
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
        replyTo: contactCheck.type === 'email' ? contact : undefined,
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

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
