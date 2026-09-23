// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

import react from '@astrojs/react';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

// Pages that are deployed for preview but must stay out of the sitemap.
const UNLISTED_PAGES = ['/tsp/projection/'];

// https://astro.build/config
export default defineConfig({
  site: 'https://fersmath.com',

  vite: {
    plugins: [tailwindcss()],
  },

  integrations: [
    react(),
    mdx(),
    sitemap({
      filter: (page) => !UNLISTED_PAGES.some((path) => page.endsWith(path)),
    }),
  ],
});