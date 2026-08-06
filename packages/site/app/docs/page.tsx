import type { Metadata } from 'next';
import Link from 'next/link';
import { JsonLd } from '@/components/JsonLd';
import { docHref, docSections, siteUrl } from '@/lib/site';
import { docMetadata } from '@/lib/doc-metadata';

export const metadata: Metadata = docMetadata('');

export default function DocsIndexPage() {
  return (
    <>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
            { '@type': 'ListItem', position: 2, name: 'Documentation', item: `${siteUrl}/docs` },
          ],
        }}
      />

      <div className="not-prose">
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Documentation</h1>
        <p className="mt-4 text-lg leading-relaxed text-muted">
          How to load Electronic Reporting configurations, read the designers, trace bindings, and
          connect to a live Finance &amp; Operations environment. Written for the person analysing
          an ER solution, not for the person building the tool.
        </p>

        <div className="mt-8 rounded-xl border border-border bg-surface-2 p-5">
          <p className="text-sm font-semibold">New here?</p>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Start with{' '}
            <Link href="/docs/getting-started" className="font-medium text-accent hover:underline">
              Getting started
            </Link>{' '}
            — it takes about five minutes and covers everything you need for the first
            configuration.
          </p>
        </div>

        {docSections.map((section) => {
          const pages = section.pages.filter((page) => page.slug !== '');
          if (pages.length === 0) return null;

          return (
            <section key={section.title} className="mt-12">
              <h2 className="font-display text-xl font-bold tracking-tight">{section.title}</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {pages.map((page) => (
                  <Link
                    key={page.slug}
                    href={docHref(page.slug)}
                    className="group rounded-xl border border-border bg-surface p-5 transition-colors hover:border-accent"
                  >
                    <h3 className="font-display text-base font-bold group-hover:text-accent">
                      {page.title}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted">{page.description}</p>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
