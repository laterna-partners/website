// Attio CRM mirror (Attio REST API v2) for the Laterna workspace.
//
// Model, confirmed against the workspace on 21 September 2026:
//   - A site is a record on the standard `deals` object, kept in the
//     "Outreach Pipeline" list. Custom attributes (slugs): site_reference
//     (unique text, the letter reference), site_address, opportunity_line,
//     searchland_url, site_notes, last_scanned (timestamp), scan_count
//     (number), last_enquiry (timestamp), last_contact_intent (text).
//   - A landowner who gets in touch is a record on the standard `people`
//     object, linked to the deal through the deal's `associated_people`.
//
// Posture mirrors src/lib/supabase.ts: no-op when ATTIO_API_KEY is unset,
// every exported function is best-effort, never throws, never blocks a page
// render or a form response beyond the fixed timeout. A scan never creates
// a deal: the deal is created when the letter is prepared, so a scan for an
// unknown reference is logged and ignored.
const ATTIO_API_BASE = 'https://api.attio.com/v2';
const DEALS = 'deals';
const PEOPLE = 'people';
const DEAL_REF_ATTR = 'site_reference';
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

type Json = Record<string, unknown>;

// One guarded call to the Attio API. Returns the parsed body on 2xx, null on
// anything else (logged). Never throws.
async function attio(method: 'GET' | 'POST' | 'PUT' | 'PATCH', path: string, body?: Json): Promise<Json | null> {
  const key = getApiKey();
  if (!key) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ATTIO_TIMEOUT_MS);
  try {
    const res = await fetch(`${ATTIO_API_BASE}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[attio] ${method} ${path} responded ${res.status} ${text.slice(0, 200)}`);
      return null;
    }
    return (await res.json()) as Json;
  } catch (err) {
    console.error(`[attio] ${method} ${path} failed`, err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function recordId(record: unknown): string | null {
  const id = (record as { id?: { record_id?: string } } | null)?.id?.record_id;
  return typeof id === 'string' ? id : null;
}

// First value of an attribute on a record, or null.
function firstValue<T>(record: unknown, attribute: string): T | null {
  const values = (record as { values?: Record<string, unknown[]> } | null)?.values?.[attribute];
  if (!Array.isArray(values) || values.length === 0) return null;
  return values[0] as T;
}

async function findDealByRef(ref: string): Promise<Json | null> {
  const res = await attio('POST', `/objects/${DEALS}/records/query`, {
    filter: { [DEAL_REF_ATTR]: { $eq: ref } },
    limit: 1,
  });
  const data = (res as { data?: Json[] } | null)?.data;
  return Array.isArray(data) && data.length > 0 ? data[0] : null;
}

// Local time in the UK, for the human-readable intent line.
function ukTime(date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

// Normalises a UK number the way a landowner types it (07700 900123,
// 020 7946 0000, +44 7700 900123) into E.164 so Attio accepts it.
function toE164(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, '');
  if (!digits) return null;
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.startsWith('44')) return `+${digits}`;
  if (digits.startsWith('0')) return `+44${digits.slice(1)}`;
  return `+44${digits}`;
}

function splitName(name: string): { first_name: string; last_name: string; full_name: string } {
  const parts = name.trim().split(/\s+/);
  const first = parts.shift() ?? '';
  return { first_name: first, last_name: parts.join(' '), full_name: name.trim() };
}

// Records a QR scan against the deal whose site_reference matches: bumps
// scan_count and sets last_scanned. Best-effort, never throws.
export async function recordScan(ref: string): Promise<void> {
  try {
    if (!getApiKey()) return;
    const deal = await findDealByRef(ref);
    const id = recordId(deal);
    if (!id) {
      console.warn(`[attio] scan for ${ref}: no deal with that site_reference`);
      return;
    }
    const current = firstValue<{ value?: number }>(deal, 'scan_count')?.value ?? 0;
    await attio('PATCH', `/objects/${DEALS}/records/${id}`, {
      data: {
        values: {
          last_scanned: new Date().toISOString(),
          scan_count: Number(current) + 1,
        },
      },
    });
  } catch (err) {
    console.error('[attio] recordScan failed', err);
  }
}

// Records a tap on Call, WhatsApp or Email against the deal, as a readable
// line: "call, 22 Sep 2026, 14:05". Best-effort, never throws.
export async function recordContactIntent(channel: 'call' | 'whatsapp' | 'email', ref: string | null): Promise<void> {
  try {
    if (!ref || !getApiKey()) return;
    const deal = await findDealByRef(ref);
    const id = recordId(deal);
    if (!id) return;
    await attio('PATCH', `/objects/${DEALS}/records/${id}`, {
      data: { values: { last_contact_intent: `${channel}, ${ukTime()}` } },
    });
  } catch (err) {
    console.error('[attio] recordContactIntent failed', err);
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

// Finds or creates the person, links them to the deal for the reference,
// stamps last_enquiry on the deal, and leaves a note on the deal with the
// message. Best-effort, never throws, never blocks the response the browser
// gets beyond the per-call timeout.
export async function upsertPersonFromEnquiry(input: EnquiryInput): Promise<void> {
  try {
    if (!getApiKey()) return;
    const email = input.email?.trim().toLowerCase() || null;
    const phone = input.phone ? toE164(input.phone) : null;
    if (!email && !phone) return;

    const nameValue = [splitName(input.name)];
    let personId: string | null = null;

    if (email) {
      // email_addresses is unique on people, so assert-by-email is safe:
      // creates the person the first time, updates them after that.
      const res = await attio('PUT', `/objects/${PEOPLE}/records?matching_attribute=email_addresses`, {
        data: {
          values: {
            name: nameValue,
            email_addresses: [{ email_address: email }],
            ...(phone ? { phone_numbers: [{ original_phone_number: phone, country_code: 'GB' }] } : {}),
          },
        },
      });
      personId = recordId((res as { data?: unknown } | null)?.data ?? null);
    } else if (phone) {
      // Phone numbers are not a unique attribute, so look first, create if
      // nothing matches. A landowner who writes twice with a differently
      // typed number may get two records; they merge in one click in Attio.
      const found = await attio('POST', `/objects/${PEOPLE}/records/query`, {
        filter: { phone_numbers: { phone_number: { $eq: phone } } },
        limit: 1,
      });
      const data = (found as { data?: Json[] } | null)?.data;
      personId = Array.isArray(data) && data.length > 0 ? recordId(data[0]) : null;
      if (!personId) {
        const created = await attio('POST', `/objects/${PEOPLE}/records`, {
          data: {
            values: {
              name: nameValue,
              phone_numbers: [{ original_phone_number: phone, country_code: 'GB' }],
            },
          },
        });
        personId = recordId((created as { data?: unknown } | null)?.data ?? null);
      }
    }

    if (!input.ref) return;
    const deal = await findDealByRef(input.ref);
    const dealId = recordId(deal);
    if (!dealId) {
      console.warn(`[attio] enquiry for ${input.ref}: no deal with that site_reference`);
      return;
    }

    // PATCH appends to multi-value attributes, so the person is added to the
    // deal's associated people without disturbing anyone already there.
    await attio('PATCH', `/objects/${DEALS}/records/${dealId}`, {
      data: {
        values: {
          last_enquiry: new Date().toISOString(),
          ...(personId
            ? { associated_people: [{ target_object: PEOPLE, target_record_id: personId }] }
            : {}),
        },
      },
    });

    const channel = email ?? phone ?? '';
    const what = input.source === 'contact' ? 'Message through the website' : 'Asked for the note on option agreements';
    const lines = [
      `${what}, ${ukTime()}.`,
      `Name: ${input.name}`,
      `Reach: ${channel}`,
      ...(input.message ? ['', input.message] : []),
    ];
    await attio('POST', '/notes', {
      data: {
        format: 'plaintext',
        parent_object: DEALS,
        parent_record_id: dealId,
        title: input.source === 'contact' ? 'Website enquiry' : 'Note requested',
        content: lines.join('\n'),
      },
    });
  } catch (err) {
    console.error('[attio] upsertPersonFromEnquiry failed', err);
  }
}
