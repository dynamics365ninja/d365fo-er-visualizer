import Link from 'next/link';
import { JsonLd } from './JsonLd';
import { docHref, docPages, siteUrl } from '@/lib/site';

/**
 * Page title block for a documentation article: visible breadcrumb, heading,
 * standfirst, and the matching BreadcrumbList structured data. Content comes
 * from lib/site so the page, the sidebar, and the sitemap always agree.
 */
export function DocHeader({ slug }: { slug: string }) {
  const page = docPages.find((candidate) => candidate.slug === slug);
  if (!page) {
    throw new Error(`Unknown documentation slug: "${slug}" — add it to docSections in lib/site.ts`);
  }

  return (
    <header className="not-prose mb-10">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
            { '@type': 'ListItem', position: 2, name: 'Documentation', item: `${siteUrl}/docs` },
            {
              '@type': 'ListItem',
              position: 3,
              name: page.title,
              item: `${siteUrl}${docHref(page.slug)}`,
            },
          ],
        }}
      />

      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs text-muted">
        <Link href="/docs" className="hover:text-accent">
          Documentation
        </Link>
        <span aria-hidden="true">/</span>
        <span>{page.navLabel ?? page.title}</span>
      </nav>

      <h1 className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl">
        {page.title}
      </h1>
      <p className="mt-4 text-lg leading-relaxed text-muted">{page.description}</p>
    </header>
  );
}
