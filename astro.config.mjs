// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

export default defineConfig({
  output: 'server',
  adapter: vercel({
    webAnalytics: { enabled: false },
    imageService: false,
    // Ship the option-agreement PDF inside the serverless function bundle so
    // /api/note-signup can fs.readFile it instead of fetching over HTTP. The
    // logo no longer needs bundling - it's referenced via hosted URL in the
    // Resend template body now that laterna.partners is publicly reachable.
    includeFiles: ['./public/notes/Laterna - Option Agreements.pdf'],
  }),
  site: 'https://laterna.partners',
  // Astro 5 enables checkOrigin by default in SSR mode and rejects form POSTs
  // whose Origin header doesn't match the request URL. Behind Vercel's proxy
  // this misfires on multipart POSTs and surfaces as
  // 'Cross-site POST form submissions are forbidden'. We only have two POST
  // endpoints (contact + note-signup). Turn off the auto-check and do our own
  // origin allowlisting, rate limiting, Turnstile and form-token checks in
  // src/lib/form-guard.ts instead, which both routes call directly.
  security: {
    checkOrigin: false,
  },
  prefetch: {
    prefetchAll: false,
    defaultStrategy: 'hover',
  },
});
