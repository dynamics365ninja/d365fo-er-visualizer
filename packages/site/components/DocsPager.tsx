'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { docHref, docNeighbours, docPages } from '@/lib/site';

export function DocsPager() {
  const pathname = usePathname();
  const current = docPages.find((page) => docHref(page.slug) === pathname);
  if (!current) return null;

  const { prev, next } = docNeighbours(current.slug);
  if (!prev && !next) return null;

  return (
    <nav
      aria-label="Documentation pagination"
      className="mt-14 grid gap-3 border-t border-border pt-8 sm:grid-cols-2"
    >
      {prev ? (
        <Link
          href={docHref(prev.slug)}
          className="rounded-xl border border-border bg-surface p-4 transition-colors hover:border-accent"
        >
          <span className="text-xs text-muted">← Previous</span>
          <span className="mt-1 block font-display text-sm font-semibold">{prev.title}</span>
        </Link>
      ) : (
        <span />
      )}

      {next && (
        <Link
          href={docHref(next.slug)}
          className="rounded-xl border border-border bg-surface p-4 text-right transition-colors hover:border-accent sm:col-start-2"
        >
          <span className="text-xs text-muted">Next →</span>
          <span className="mt-1 block font-display text-sm font-semibold">{next.title}</span>
        </Link>
      )}
    </nav>
  );
}
