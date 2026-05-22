// POST /api/contact: handles the "Write something here instead" form
// from the Contact section. Emails Hayri via Resend, persists to Supabase.
// Returns 200 with JSON on success, 400/500 on failure. The client-side
// script swaps to a thank-you state when it sees 200.
import type { APIRoute } from 'astro';
import { getResend, NOTIFY_EMAIL, FROM_EMAIL } from '../../lib/resend';
import { getSupabase } from '../../lib/supabase';

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

  const name = ((form.get('name') as string) ?? '').trim();
  const contact = ((form.get('contact') as string) ?? '').trim();
  const site = ((form.get('site') as string) ?? '').trim();
  const message = ((form.get('message') as string) ?? '').trim();

  if (!name || !contact) {
    return new Response(JSON.stringify({ error: 'Name and contact required' }), { status: 400 });
  }

  // Best-effort persist
  const supabase = getSupabase();
  if (supabase) {
    const { error } = await supabase.from('contact_submissions').insert({
      form_type: 'contact',
      name,
      contact_method: contact,
      site_ref: site || null,
      message: message || null,
      arrival_ref: locals.ref ?? null,
    });
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
  ].filter(Boolean).join('\n');

  if (resend) {
    try {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: NOTIFY_EMAIL,
        replyTo: contact.includes('@') ? contact : undefined,
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
