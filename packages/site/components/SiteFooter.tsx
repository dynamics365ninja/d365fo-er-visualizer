import Link from 'next/link';
import { Logo } from './Logo';
import { appPath, repoUrl, siteName } from '@/lib/site';

const projectLinks = [
  { href: repoUrl, label: 'GitHub repository' },
  { href: `${repoUrl}/issues`, label: 'Report an issue' },
  { href: `${repoUrl}/blob/main/LICENSE`, label: 'MIT license' },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-bg-soft">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <div className="flex items-center gap-2.5">
            <Logo className="h-8 w-8" />
            <span className="font-display text-base font-bold tracking-tight">{siteName}</span>
          </div>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted">
            An open-source workspace for reading Dynamics 365 Finance &amp; Operations Electronic
            Reporting configurations. Free, MIT-licensed, and your files never leave your browser.
          </p>
        </div>

        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Product</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <Link href={appPath} className="text-text hover:text-accent">
                Open the app
              </Link>
            </li>
            <li>
              <Link href="/features" className="text-text hover:text-accent">
                Features
              </Link>
            </li>
            <li>
              <Link href="/docs" className="text-text hover:text-accent">
                Documentation
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Project</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {projectLinks.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-text hover:text-accent"
                >
                  {link.label}
                </a>
              </li>
            ))}
            <li>
              <Link href="/docs/getting-started" className="text-text hover:text-accent">
                Getting started
              </Link>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-5 py-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} D365FO ER Visualizer contributors · MIT licensed</p>
          <p>
            Not affiliated with or endorsed by Microsoft. Dynamics 365 is a trademark of Microsoft
            Corporation.
          </p>
        </div>
      </div>
    </footer>
  );
}
