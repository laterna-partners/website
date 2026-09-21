-- V2 landowners page: capture-layer schema changes.
-- Written for review, not applied. Run by hand (or via CI) against the
-- Laterna Supabase project when ready.
--
-- Existing tables this migration builds on (inferred from src/lib/supabase.ts
-- callers, no earlier migration files exist in this repo):
--   qr_scans (ref, path, user_agent, referer, plus default id/created_at)
--   contact_submissions (form_type, name, contact_method, site_ref, message,
--     phone, arrival_ref, plus default id/created_at)
--
-- The code reads the anon (publishable) key, not the service role key, so
-- every policy below follows the existing anon-insert-only posture: the
-- anon role can INSERT but never SELECT/UPDATE/DELETE, matching the comment
-- in src/lib/supabase.ts ("reading the rows is done via the Supabase
-- dashboard with Hayri's auth"). site_hints is the one exception: it needs
-- anon SELECT because src/lib/site-hints.ts reads it synchronously on every
-- page render with the same anon key.

-- ---------------------------------------------------------------------------
-- site_hints: replaces the hard-coded map in src/lib/site-hints.ts as the
-- primary source, which remains as a fallback if a row is missing or the
-- lookup times out.
-- ---------------------------------------------------------------------------
create table if not exists site_hints (
  ref text primary key,
  hint text not null,
  created_at timestamptz not null default now()
);

alter table site_hints enable row level security;

-- Read-only for anon: the page looks a ref up but never writes here.
-- Postgres has no CREATE POLICY IF NOT EXISTS, so drop-then-create to keep
-- this migration re-runnable.
drop policy if exists "site_hints anon select" on site_hints;
create policy "site_hints anon select"
  on site_hints for select
  to anon
  using (true);

-- ---------------------------------------------------------------------------
-- click_events: new table for POST /api/click (Call / WhatsApp / Email link
-- taps). Same posture as qr_scans: best-effort insert, no read access for
-- anon, rows read from the dashboard.
-- ---------------------------------------------------------------------------
create table if not exists click_events (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('call', 'whatsapp', 'email')),
  ref text,
  path text,
  user_agent text,
  created_at timestamptz not null default now()
);

alter table click_events enable row level security;

drop policy if exists "click_events anon insert" on click_events;
create policy "click_events anon insert"
  on click_events for insert
  to anon
  with check (true);

-- ---------------------------------------------------------------------------
-- contact_submissions: add the note-request flag used by both forms.
--
-- No new `ref` column is added here. The merged contact form already has a
-- `site_ref` column for its visible, editable site-reference field, and the
-- take-home-note form's `ref` field is only a hidden echo of the page's
-- arrival ref (see TakeHomeNote.astro / src/pages/api/note-signup.ts), which
-- the existing `arrival_ref` column already covers. Adding a third,
-- overlapping `ref` column would just duplicate one of those two, so per the
-- brief's own condition ("only if arrival_ref does not already exist") this
-- migration skips it.
-- ---------------------------------------------------------------------------
alter table contact_submissions
  add column if not exists note_requested boolean not null default false;

-- No RLS change needed here: contact_submissions already allows anon INSERT
-- only, which both routes rely on and this migration doesn't touch.
