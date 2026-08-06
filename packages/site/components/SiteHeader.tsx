import Link from 'next/link';
import { Logo } from './Logo';
import { ThemeSwitch } from './ThemeSwitch';
import { appPath, primaryNav, siteName } from '@/lib/site';

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-5">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2.5 font-display text-[0.95rem] font-bold tracking-tight"
        >
          <Logo className="h-7 w-7" />
          <span className="hidden sm:inline">{siteName}</span>
          <span className="sm:hidden">ER Visualizer</span>
        </Link>

        <nav aria-label="Main" className="ml-auto hidden items-center gap-1 md:flex">
          {primaryNav.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text"
              {...(link.href.startsWith('http')
                ? { target: '_blank', rel: 'noreferrer noopener' }
                : {})}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2 md:ml-0">
          <ThemeSwitch />
          <Link
            href={appPath}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast transition-colors hover:bg-accent-hover"
          >
            Open the app
          </Link>
        </div>
      </div>

      {/* Mobile navigation — no JavaScript, just a second row. */}
      <nav
        aria-label="Main (compact)"
        className="flex items-center gap-1 overflow-x-auto border-t border-border px-5 py-2 md:hidden"
      >
        {primaryNav.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="shrink-0 rounded-md px-2.5 py-1.5 text-sm font-medium text-muted hover:text-text"
            {...(link.href.startsWith('http')
              ? { target: '_blank', rel: 'noreferrer noopener' }
              : {})}
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
