/**
 * articles.ts
 *
 * Helpers over the `articles` content collection (see src/content.config.ts),
 * shared by the homepage "Latest Articles" cards, the /blog list, and the
 * article pages.
 */

import { getCollection, type CollectionEntry } from 'astro:content';

export type Article = CollectionEntry<'articles'>;

/**
 * Articles to show, newest first. Drafts are included while running
 * `astro dev` so they can be previewed, and left out of production builds.
 */
export async function getArticles(): Promise<Article[]> {
  const entries = await getCollection(
    'articles',
    ({ data }) => import.meta.env.DEV || !data.draft,
  );
  return entries.sort((a, b) => b.data.published.getTime() - a.data.published.getTime());
}

export function articleUrl(article: Article): string {
  return `/blog/${article.id}/`;
}

/** Frontmatter override, else ~200 words a minute over the Markdown body */
export function readMinutes(article: Article): number {
  if (article.data.readMinutes) return article.data.readMinutes;
  const words = (article.body ?? '').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

/** "Sep 23, 2026" — formatted in UTC so the build machine's timezone can't shift the day */
export function formatPublished(date: Date, month: 'short' | 'long' = 'short'): string {
  return date.toLocaleDateString('en-US', {
    month,
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** YYYY-MM-DD, for <time datetime> and article:published_time */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
