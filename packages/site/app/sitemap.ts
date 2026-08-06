import type { MetadataRoute } from 'next';
import { docHref, docPages, siteUrl } from '@/lib/site';

/**
 * The SPA under /app is deliberately absent: it is an application shell with
 * no indexable content, and it carries a noindex meta tag of its own.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return [
    { url: `${siteUrl}/`, lastModified, changeFrequency: 'monthly', priority: 1 },
    { url: `${siteUrl}/features`, lastModified, changeFrequency: 'monthly', priority: 0.8 },
    ...docPages.map((page) => ({
      url: `${siteUrl}${docHref(page.slug)}`,
      lastModified,
      changeFrequency: 'monthly' as const,
      priority: page.slug === '' ? 0.8 : 0.7,
    })),
  ];
}
