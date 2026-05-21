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
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
