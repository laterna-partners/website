// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

export default defineConfig({
  output: 'server',
  adapter: vercel({
    webAnalytics: { enabled: false },
    imageService: false,
    // Ship the option-agreement PDF + brand logo inside the serverless
    // function bundle so /api/note-signup can fs.readFile them instead of
    // fetching over HTTP (which hits deployment protection and adds cold-
    // start latency). The logo is sent as an inline CID attachment in the
    // requester email so the signature renders even when remote images
    // are blocked.
    includeFiles: [
      './public/notes/Laterna - Option Agreements.pdf',
      './public/assets/laterna-logo-full.png',
    ],
  }),
  site: 'https://laterna.partners',
  // Astro 5 enables checkOrigin by default in SSR mode and rejects form POSTs
  // whose Origin header doesn't match the request URL. Behind Vercel's proxy
  // this misfires on multipart POSTs and surfaces as
  // 'Cross-site POST form submissions are forbidden'. We only have two POST
  // endpoints (contact + note-signup), both already protected by a honeypot
  // and input validation. Turn off the auto-check.
  security: {
    checkOrigin: false,
  },
  prefetch: {
    prefetchAll: false,
    defaultStrategy: 'hover',
  },
});
