'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { docHref, docSections } from '@/lib/site';

export function DocsSidebar() {
  const pathname = usePathname();

  return (
    <nav aria-label="Documentation" className="lg:sticky lg:top-24">
      <ul className="space-y-7">
        {docSections.map((section) => (
          <li key={section.title}>
            {/* Deliberately not a heading: the sidebar precedes the article's
                h1, and section labels here would distort the outline. */}
            <p className="px-3 text-xs font-semibold uppercase tracking-wider text-muted">
              {section.title}
            </p>
            <ul className="mt-2 space-y-0.5">
              {section.pages.map((page) => {
                const href = docHref(page.slug);
                const active = pathname === href;
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-current={active ? 'page' : undefined}
                      className={`block rounded-md px-3 py-1.5 text-sm transition-colors ${
                        active
                          ? 'bg-accent-soft font-semibold text-accent'
                          : 'text-muted hover:bg-surface-2 hover:text-text'
                      }`}
                    >
                      {page.navLabel ?? page.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  );
}
