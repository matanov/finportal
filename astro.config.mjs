// @ts-check
import { defineConfig } from 'astro/config';
import { readdirSync, readFileSync } from 'node:fs';
import tailwindcss from '@tailwindcss/vite';

import react from '@astrojs/react';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

const site = 'https://fersmath.com';

// Articles marked `unlisted: true` are deployed at their direct URL but must
// stay out of the sitemap. The sitemap filter runs before the content
// collection is available, so this reads each article's frontmatter directly.
const articlesDir = new URL('./src/content/articles/', import.meta.url);
const unlistedPages = readdirSync(articlesDir)
  .filter((file) => file.endsWith('.mdx') && !file.startsWith('_'))
  .filter((file) => {
    const frontmatter = readFileSync(new URL(file, articlesDir), 'utf8').split(/^---\s*$/m)[1] ?? '';
    return /^unlisted:\s*true\s*$/m.test(frontmatter);
  })
  .map((file) => `${site}/blog/${file.replace(/\.mdx$/, '')}/`);

// https://astro.build/config
export default defineConfig({
  site,

  vite: {
    // `astro check` and `astro build` pre-bundle dependencies in production mode (production React).
    // Sharing Vite's cache with a running `astro dev` let them overwrite its copy, and on the dev
    // server's next restart every React island failed with "_jsxDEV is not a function". The dev server
    // gets its own cache so the two can't collide.
    cacheDir: process.argv.includes('dev') ? 'node_modules/.vite-dev' : undefined,
    plugins: [tailwindcss()],
  },

  integrations: [react(), mdx(), sitemap({ filter: (page) => !unlistedPages.includes(page) })],
});