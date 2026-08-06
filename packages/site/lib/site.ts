/**
 * Single source of truth for site-wide constants: canonical URL, product
 * naming, navigation, and the documentation table of contents.
 */

/**
 * Canonical origin. Set NEXT_PUBLIC_SITE_URL in Vercel to the production
 * domain; preview deployments fall back to their own generated URL.
 */
export const siteUrl = (
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_ENV === 'production' && process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000')
).replace(/\/$/, '');

export const siteName = 'D365FO ER Visualizer';

export const siteTagline =
  'Visual designer and analyzer for Dynamics 365 Finance & Operations Electronic Reporting configurations';

export const siteDescription =
  'Open ER XML bundles or connect to a live D365 Finance & Operations environment, then trace format bindings through model mappings down to the concrete table, class, or enum data source — in the browser, in seconds.';

export const repoUrl = 'https://github.com/dynamics365ninja/d365fo-er-visualizer';

export const appPath = '/app';

export interface NavLink {
  href: string;
  label: string;
}

export const primaryNav: NavLink[] = [
  { href: '/features', label: 'Features' },
  { href: '/docs', label: 'Documentation' },
  { href: repoUrl, label: 'GitHub' },
];

export interface DocPage {
  slug: string;
  title: string;
  /** Sidebar label — shorter than the page title where that reads better. */
  navLabel?: string;
  description: string;
}

export interface DocSection {
  title: string;
  pages: DocPage[];
}

/**
 * Documentation order. Drives the sidebar, the prev/next footer links, and
 * the sitemap — add a page here and everything else follows.
 */
export const docSections: DocSection[] = [
  {
    title: 'Getting started',
    pages: [
      {
        slug: '',
        title: 'Documentation',
        navLabel: 'Overview',
        description:
          'What the ER Visualizer does, who it is for, and where to start reading.',
      },
      {
        slug: 'getting-started',
        title: 'Getting started',
        description:
          'Open the app, load your first Electronic Reporting configuration, and find your way around the workspace.',
      },
      {
        slug: 'loading-configurations',
        title: 'Loading configurations',
        navLabel: 'Loading files',
        description:
          'Which ER XML files the visualizer accepts, how bundles are unwrapped, and why loading all three component types matters.',
      },
    ],
  },
  {
    title: 'Working with configurations',
    pages: [
      {
        slug: 'designers',
        title: 'Data model, mapping, and format designers',
        navLabel: 'Visual designers',
        description:
          'How each of the three ER component types is visualized, and what the nodes, edges, and badges mean.',
      },
      {
        slug: 'search-and-where-used',
        title: 'Search and where-used',
        description:
          'Full-text search across every loaded configuration, and tracing an element to every binding that consumes it.',
      },
      {
        slug: 'expression-drill-down',
        title: 'Expression drill-down',
        description:
          'Follow an ER formula through calculated fields and model bindings to the concrete table, class, or enum behind it.',
      },
    ],
  },
  {
    title: 'Connecting and deploying',
    pages: [
      {
        slug: 'connect-to-fno',
        title: 'Connect to a live F&O environment',
        navLabel: 'F&O connection',
        description:
          'Register an Entra application, create a connection profile, and ingest ER configurations straight from Dynamics 365 Finance & Operations.',
      },
      {
        slug: 'desktop-app',
        title: 'Desktop app',
        description:
          'Run the Electron shell for native file dialogs and loopback sign-in when browser popups are blocked.',
      },
      {
        slug: 'troubleshooting',
        title: 'Troubleshooting',
        description:
          'Fixes for the errors people actually hit: sign-in failures, empty downloads, unresolved bindings, and missing model mappings.',
      },
    ],
  },
];

export const docPages: DocPage[] = docSections.flatMap((section) => section.pages);

export function docHref(slug: string): string {
  return slug ? `/docs/${slug}` : '/docs';
}

export function docNeighbours(slug: string): { prev?: DocPage; next?: DocPage } {
  const index = docPages.findIndex((page) => page.slug === slug);
  if (index === -1) return {};
  return {
    prev: index > 0 ? docPages[index - 1] : undefined,
    next: index < docPages.length - 1 ? docPages[index + 1] : undefined,
  };
}
