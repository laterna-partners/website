/// <reference path="../.astro/types.d.ts" />

declare namespace App {
  interface Locals {
    ref?: string;
    siteHint?: string | null;
  }
}

interface ImportMetaEnv {
  readonly RESEND_API_KEY?: string;
  readonly NOTIFY_EMAIL?: string;
  readonly FROM_EMAIL?: string;
  readonly PUBLIC_SUPABASE_URL?: string;
  readonly SUPABASE_SERVICE_ROLE_KEY?: string;
  // Build-time public value: the Cloudflare Turnstile site key rendered into
  // the landowners-page forms. The matching secret (TURNSTILE_SECRET_KEY) is
  // server-only and read via process.env, not import.meta.env.
  readonly PUBLIC_TURNSTILE_SITE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
