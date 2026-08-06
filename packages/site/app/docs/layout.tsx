import Link from 'next/link';
import { DocsPager } from '@/components/DocsPager';
import { DocsSidebar } from '@/components/DocsSidebar';
import { appPath, repoUrl } from '@/lib/site';

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-5 py-12 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-14">
      <aside>
        <DocsSidebar />

        <div className="mt-8 rounded-xl border border-border bg-surface p-4 lg:sticky lg:top-[28rem]">
          <p className="text-sm font-semibold">Ready to try it?</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            The app runs in your browser — no install, no sign-up.
          </p>
          <Link
            href={appPath}
            className="mt-3 inline-block rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-accent-contrast hover:bg-accent-hover"
          >
            Open the app
          </Link>
        </div>
      </aside>

      <div className="min-w-0">
        <article className="prose">{children}</article>
        <DocsPager />

        <p className="mt-8 text-sm text-muted">
          Something missing or wrong?{' '}
          <a
            href={`${repoUrl}/issues`}
            target="_blank"
            rel="noreferrer noopener"
            className="font-medium text-accent hover:underline"
          >
            Open an issue on GitHub
          </a>
          .
        </p>
      </div>
    </div>
  );
}
