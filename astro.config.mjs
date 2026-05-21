// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

export default defineConfig({
  output: 'server',
  adapter: vercel({
    webAnalytics: { enabled: false },
    imageService: false,
  }),
  site: 'https://laterna.partners',
  prefetch: {
    prefetchAll: false,
    defaultStrategy: 'hover',
  },
});
