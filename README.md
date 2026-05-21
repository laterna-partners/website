# Laterna+Partners — website

The `/landowners` landing page (and future site) for laterna.partners.
Built with Astro + Vercel adapter, ported from the Claude Design handoff.

## Run locally

```bash
cd "$HOME/Claude/Laterna/website"
npm install
npm run dev
```

Open <http://localhost:4321/landowners> for the cold-arrival view,
or <http://localhost:4321/landowners?ref=SITE-26-0418> for the QR-arrival
view (with the ref strip + site-hint personalisation).

Root `/` redirects to `/landowners`.

## Project layout

```
src/
  layouts/Base.astro       — head, fonts, global CSS
  components/              — one .astro per design section
    Hero.astro, HowItWorks.astro, RiskReversal.astro,
    AboutHayri.astro, TakeHomeNote.astro, Contact.astro,
    SiteHeader.astro, SiteFooter.astro, StickyCall.astro,
    RefStrip.astro, Wordmark.astro, Label.astro,
    Section.astro, Marginalia.astro
  pages/
    index.astro            — redirects to /landowners
    landowners.astro       — composes the page
    api/contact.ts         — POST: contact form -> Resend + Supabase
    api/note-signup.ts     — POST: take-home note form
  middleware.ts            — captures ?ref=SITE-xxx, logs to Supabase
  lib/
    resend.ts, supabase.ts — clients with graceful fall-back when
                              env vars aren't set yet
    site-hints.ts          — ref -> "the land at..." phrase mapping
  styles/tokens.css        — design tokens (colors, type, spacing)
public/
  assets/                  — logos, portrait, favicon
  fonts/                   — Mulish variable font (self-hosted)
```

## Environment variables

Copy `.env.example` to `.env` and fill in:

- `RESEND_API_KEY` — from resend.com (free tier covers our volume)
- `NOTIFY_EMAIL` — where form submissions are sent (default: hayri@laterna.partners)
- `FROM_EMAIL` — verified sender address on Resend
- `PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — from the Laterna
  Supabase project (separate from FlowSpace)

The site runs without these set — emails are logged to console, scans
likewise. Useful during early setup.

## Deploy

Vercel CLI: `vercel` from this directory. The `@astrojs/vercel` adapter
handles the rest. Set env vars in the Vercel dashboard.

## Why these choices

- **Astro over WordPress**: faster page load, version-controlled, the
  RE-line/site-hint personalisation needs server-rendering which Astro
  with `output: 'server'` gives us.
- **Vercel over alternatives**: zero-config Astro deploys, native
  serverless functions for the form endpoints, generous free tier.
- **Resend over Formspree/Mailgun**: clean SDK, transactional-email focus,
  React-friendly defaults. Free tier easily covers expected volume.
- **Supabase over Vercel KV**: Postgres lets us run queries like "how
  many scans per ref this month" cleanly. Separate account from
  FlowSpace per the project rule.
