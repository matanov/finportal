/**
 * articles.ts
 *
 * Published articles, newest first. The homepage "Latest Articles" section,
 * the /blog list, and each article page's byline all read from here, so a
 * new article only needs an entry here plus its page under src/pages/blog/.
 */

export interface Article {
  /** URL slug under /blog/ — must match the page file name */
  slug: string;
  title: string;
  /** One or two sentences; also used as the page's meta description */
  description: string;
  category: string;
  /** ISO date, YYYY-MM-DD */
  published: string;
  readMinutes: number;
}

export const ARTICLES: Article[] = [
  {
    slug: 'federal-compensation-vs-social-security-wage-maximum',
    title: 'Federal Compensation vs. Social Security Wage Maximum',
    description:
      'How GS salaries have kept pace with the Social Security wage base since 2011, with interactive charts by grade, step and locality.',
    category: 'Federal Pay',
    published: '2026-09-23',
    readMinutes: 5,
  },
];

export function articleUrl(article: Article): string {
  return `/blog/${article.slug}/`;
}

export function getArticle(slug: string): Article {
  const article = ARTICLES.find((a) => a.slug === slug);
  if (!article) throw new Error(`No article registered for slug "${slug}"`);
  return article;
}

/** "Sep 23, 2026" — parsed as UTC so the build machine's timezone can't shift the day */
export function formatPublished(iso: string, month: 'short' | 'long' = 'short'): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    month,
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
