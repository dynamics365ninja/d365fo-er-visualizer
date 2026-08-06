import type { Metadata } from 'next';
import { docHref, docPages, siteName } from './site';

/**
 * Builds page metadata from the documentation table of contents so titles,
 * descriptions, and canonical URLs cannot drift out of sync with the sidebar.
 */
export function docMetadata(slug: string): Metadata {
  const page = docPages.find((candidate) => candidate.slug === slug);
  if (!page) {
    throw new Error(`Unknown documentation slug: "${slug}" — add it to docSections in lib/site.ts`);
  }

  const url = docHref(page.slug);

  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: url },
    openGraph: {
      type: 'article',
      title: `${page.title} · ${siteName}`,
      description: page.description,
      url,
    },
    twitter: {
      title: `${page.title} · ${siteName}`,
      description: page.description,
    },
  };
}
