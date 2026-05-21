// POST /api/note-signup — handles the take-home-note form.
// Same logic as /api/contact but tagged as 'note-signup' so we can later
// segment leads (people who wanted the PDF vs. people who wrote in directly).
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
  const subject = `Note signup — ${name}`;
  const body = [
    `Name: ${name}`,
    `Email: ${email}`,
    phone && `Phone: ${phone}`,
    locals.ref && `Arrived via: ${locals.ref}`,
    '',
    'They want the option-agreement explainer note when it is ready.',
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
      console.error('[note-signup] resend failed', err);
    }
  } else {
    console.log('[note-signup] would email:', subject, '\n', body);
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
