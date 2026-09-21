// Attio CRM mirror (Attio REST API v2). Mirrors src/lib/supabase.ts's
// "return null / degrade gracefully if unset" pattern: every exported
// function here is best-effort, never throws, and never blocks a page render
// or a form response beyond the fixed timeout below.
//
// The object and attribute slugs in the config block are placeholders and
// are to be confirmed against the real Laterna Attio workspace before this
// is relied on for production data (see the project's out-flow note,
// section 3e - only Hayri can confirm the workspace's actual object model).
const ATTIO_API_BASE = 'https://api.attio.com/v2';
const ATTIO_SITE_OBJECT = 'sites';
const ATTIO_SITE_REF_ATTR = 'ref';
const ATTIO_PERSON_OBJECT = 'people';
const ATTIO_PERSON_EMAIL_ATTR = 'email_addresses';
const ATTIO_PERSON_PHONE_ATTR = 'phone_numbers';
const ATTIO_TIMEOUT_MS = 3_000;

let warned = false;

function getApiKey(): string | null {
  const key = process.env.ATTIO_API_KEY;
  if (!key) {
    if (!warned) {
      console.warn('[attio] ATTIO_API_KEY not set; CRM sync skipped');
      warned = true;
    }
    return null;
  }
  return key;
}

// Asserts (creates-or-updates) a record by a matching attribute, using
// Attio's v2 assert endpoint: PUT /objects/{object}/records?matching_attribute=...
// A no-op if ATTIO_API_KEY isn't set. Never throws; failures are logged only.
async function assertRecord(
  object: string,
  matchingAttribute: string,
  values: Record<string, unknown>,
): Promise<void> {
  const key = getApiKey();
  if (!key) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ATTIO_TIMEOUT_MS);
  try {
    const url = `${ATTIO_API_BASE}/objects/${object}/records?matching_attribute=${encodeURIComponent(matchingAttribute)}`;
    const res = await fetch(url, {
      method: 'PUT',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ data: { values } }),
    });
    if (!res.ok) {
      console.error(`[attio] assert ${object} responded ${res.status}`);
    }
  } catch (err) {
    console.error(`[attio] assert ${object} request failed`, err);
  } finally {
    clearTimeout(timeout);
  }
}

// Records a QR scan against the matching Site record, matched by ref.
// Best-effort: never throws, never blocks the page it's called from.
export async function recordScan(ref: string): Promise<void> {
  try {
    await assertRecord(ATTIO_SITE_OBJECT, ATTIO_SITE_REF_ATTR, {
      [ATTIO_SITE_REF_ATTR]: ref,
      last_scanned_at: new Date().toISOString(),
    });
  } catch (err) {
    // assertRecord already catches its own errors; this is a last-resort
    // guard so a mistake in that function can never surface here.
    console.error('[attio] recordScan failed', err);
  }
}

export interface EnquiryInput {
  name: string;
  email?: string | null;
  phone?: string | null;
  ref?: string | null;
  message?: string | null;
  source: 'contact' | 'note-signup';
}

// Upserts a Person record from a form submission, matched on email when
// given, otherwise on phone. Best-effort: never throws, never blocks the
// response the browser gets.
export async function upsertPersonFromEnquiry(input: EnquiryInput): Promise<void> {
  try {
    const matchingAttribute = input.email ? ATTIO_PERSON_EMAIL_ATTR : ATTIO_PERSON_PHONE_ATTR;
    const matchValue = input.email ?? input.phone;
    if (!matchValue) return;

    await assertRecord(ATTIO_PERSON_OBJECT, matchingAttribute, {
      name: input.name,
      ...(input.email ? { [ATTIO_PERSON_EMAIL_ATTR]: input.email } : {}),
      ...(input.phone ? { [ATTIO_PERSON_PHONE_ATTR]: input.phone } : {}),
      ...(input.ref ? { [ATTIO_SITE_REF_ATTR]: input.ref } : {}),
      ...(input.message ? { notes: input.message } : {}),
      source: input.source,
    });
  } catch (err) {
    console.error('[attio] upsertPersonFromEnquiry failed', err);
  }
}
