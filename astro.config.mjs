// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';

// Draft pages that are deployed but must stay out of the sitemap.
const DRAFT_PAGES = ['/blog/federal-compensation-vs-social-security-wage-maximum/'];

// https://astro.build/config
export default defineConfig({
  site: 'https://fersmath.com',

  vite: {
    plugins: [tailwindcss()],
  },

  integrations: [
    react(),
    sitemap({
      filter: (page) => !DRAFT_PAGES.some((path) => page.endsWith(path)),
    }),
  ],
});