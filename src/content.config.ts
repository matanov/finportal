/**
 * content.config.ts
 *
 * The `articles` collection: every published article on the site.
 *
 * HOW TO ADD AN ARTICLE
 *   1. Copy src/content/articles/_template.mdx to a new file in the same
 *      folder. The file name becomes the URL:
 *        src/content/articles/my-new-article.mdx  →  /blog/my-new-article/
 *      Files whose names start with "_" are ignored, which is why the
 *      template itself never gets published.
 *   2. Fill in the frontmatter between the two `---` lines. The fields and
 *      their rules are defined in the schema below; `npm run build` fails
 *      with a clear message if one is missing or malformed.
 *   3. Write the body in Markdown: headings, lists, links, tables, `---` for
 *      a section break, and footnotes with [^name]. Interactive charts and
 *      other components are imported at the top of the file and dropped in
 *      like HTML tags (see the first article for examples).
 *   4. Leave `draft: true` while working on it. Drafts show up in
 *      `astro dev` but are left out of the production build, so they are
 *      not deployed, listed or indexed. Delete the line (or set it to
 *      false) to publish; the article then appears on the homepage, in
 *      /blog, and in the sitemap automatically.
 *      To preview a draft on the live site without publishing it, use
 *      `unlisted: true` instead of `draft: true`. It is deployed at its
 *      direct URL, but kept off the homepage and /blog, out of the sitemap,
 *      and marked noindex. Anyone with the link can still open it.
 *
 * Page chrome (breadcrumb, byline, typography, meta tags) comes from
 * src/layouts/ArticleLayout.astro, so every article looks the same without
 * any styling in the article file itself.
 */

import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const articles = defineCollection({
  loader: glob({ base: './src/content/articles', pattern: ['**/*.mdx', '!**/_*'] }),
  schema: z.object({
    title: z.string(),
    /** One or two sentences: shown on article cards and used as the meta description */
    description: z.string().max(200),
    /** Short label shown above the title, e.g. "Federal Pay" */
    category: z.string(),
    /** Publish date, written as YYYY-MM-DD */
    published: z.coerce.date(),
    /** Optional override; otherwise estimated from the word count */
    readMinutes: z.number().int().positive().optional(),
    draft: z.boolean().default(false),
    /** Live at its URL, but hidden: not on the homepage or /blog, not in the sitemap, marked noindex */
    unlisted: z.boolean().default(false),
  }),
});

export const collections = { articles };
