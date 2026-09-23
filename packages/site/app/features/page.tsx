import type { Metadata } from 'next';
import Link from 'next/link';
import { JsonLd } from '@/components/JsonLd';
import { appPath, siteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Features',
  description:
    'Everything the D365FO ER Visualizer does: XML and live F&O ingestion, visual designers for data models, mappings and formats, where-used tracing, expression drill-down, side-by-side tab groups, Excel and PDF preview, label resolution, and an optional desktop shell.',
  alternates: { canonical: '/features' },
  openGraph: {
    title: 'Features · D365FO ER Visualizer',
    description:
      'XML and live F&O ingestion, visual designers, where-used tracing, expression drill-down, Excel and PDF preview, and more.',
    url: '/features',
  },
};

interface FeatureBlock {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
  docHref: string;
  docLabel: string;
}

const blocks: FeatureBlock[] = [
  {
    id: 'ingestion',
    eyebrow: 'Getting data in',
    title: 'Load from disk or straight from Finance & Operations',
    body: 'The parser handles the shapes ER exports actually come in, so you do not have to unwrap anything by hand. Drop several files at once — they are merged into one workspace and cross-referenced together.',
    points: [
      'Drag-and-drop or file picker for exported ER XML',
      'ErFnoBundle exports, bare-content files, and base64-wrapped payloads are unwrapped automatically',
      'The correct configuration version node is resolved for you',
      'Live ingestion from an F&O environment via the ER custom services',
    ],
    docHref: '/docs/loading-configurations',
    docLabel: 'Loading configurations',
  },
  {
    id: 'designers',
    eyebrow: 'Seeing structure',
    title: 'A designer view for each component type',
    body: 'Every configuration type gets a layout built for how that artifact is actually read. Trees and lists stay fast with thousands of rows, and clicking any formula or datasource opens its drill-down.',
    points: [
      'Data model — a field list by default: records and fields as a tree with type, enum, and label, a filter over every field path, and where-used per field; switch to Graph for containers with type-reference edges',
      'Model mapping — separate views for the binding tree, datasources grouped by kind, and validations',
      'Format — hierarchical element tree with binding-status badges, plus a Bindings view grouped by intent',
      'Excel-based formats render the template with its original layout and named ranges — click a cell to reach the element bound to it',
      'PDF formats preview the component they convert, so a PDF reads like the Excel format behind it',
      'Label references are resolved to text across every loaded configuration, so models and mappings read in words rather than ids',
    ],
    docHref: '/docs/designers',
    docLabel: 'Visual designers',
  },
  {
    id: 'search',
    eyebrow: 'Finding things',
    title: 'Search everything, then trace it backwards',
    body: 'A single index spans every loaded configuration. Search it by name, and when you find what you were looking for, ask which parts of the solution depend on it.',
    points: [
      'Full-text search across data models, mappings, and formats at once, ranked by relevance — exact names first',
      'Where-used from the inspector, an Explorer row’s menu, a datasource’s magnifier button, or Ctrl+U — for datasources, model fields and records, and enums',
      'Where-used returns every format element, mapping binding, and expression that references an element',
      'Results carry their source context, so you can tell duplicates apart',
      'Where-used results group by file, with a scope toggle for mappings only or format only',
    ],
    docHref: '/docs/search-and-where-used',
    docLabel: 'Search and where-used',
  },
  {
    id: 'drill-down',
    eyebrow: 'Understanding formulas',
    title: 'Drill through an expression to its real source',
    body: 'ER formulas nest calculated fields inside calculated fields. One click on a formula or datasource opens the drill-down: the whole value path from the format expression down to D365FO, expanded, so you never lose the thread.',
    points: [
      'Click to open it in a dialog; double-click or Ctrl+click to open it as a tab — or pin the dialog as a tab, or open it to the side',
      'Select any part of the expression to narrow the value path to what it resolves to',
      'A summary lists the D365FO tables, classes, and calculated fields the expression finally reads',
      'Keep drilling until you reach the concrete table, class, enum, or user parameter',
      'In the property inspector, identifiers in formulas are links with a tooltip card for the resolved source',
      'A second view lays the whole breakdown out as a node graph when you want the width rather than one thread',
    ],
    docHref: '/docs/expression-drill-down',
    docLabel: 'Expression drill-down',
  },
  {
    id: 'fno',
    eyebrow: 'Live environments',
    title: 'Browse and ingest a live ER solution tree',
    body: 'Sign in with your Microsoft work account, walk the ER solution hierarchy of the environment, and pull down exactly the configurations you need — including the ones you did not know you needed.',
    points: [
      'Multi-select configurations across drill levels in one session',
      'Ancestor data models are discovered and included automatically',
      'Model mappings are fetched per data model so bindings resolve end to end',
      'Live configurations sit in the same workspace as files opened from disk',
      'Connection profiles are remembered between visits — environment, tenant and client id, no secrets',
      'A progress panel shows every configuration as it is queued, downloaded, skipped, or fails — and a running download can be cancelled',
    ],
    docHref: '/docs/connect-to-fno',
    docLabel: 'F&O connection',
  },
  {
    id: 'workspace',
    eyebrow: 'Day-to-day use',
    title: 'A workspace built for reading, not clicking',
    body: 'Tab groups, a resizable layout, and a property inspector that adapts to whatever you selected — the parts you expect from an IDE, without the parts you do not need for analysis.',
    points: [
      'Two tab groups side by side, like an IDE — drag a tab across, or pick “Open to the side”, to compare two views',
      'An explorer tree that can group everything by data model — click selects, double-click or Enter opens',
      'A workspace manager listing exactly what is loaded — add, close, or re-add a single configuration',
      'Recent sessions and recent configurations re-open from a local browser cache, with no second trip to the environment',
      'Context-aware property inspector for files, containers, fields, datasources, and bindings — a format element’s bindings first',
      'Keyboard shortcuts for search (Ctrl+F), where-used (Ctrl+U), the explorer (Ctrl+B), and the inspector (Ctrl+J)',
      'Technical mode reveals GUIDs and raw expressions when you need the underlying detail',
      'System, light and dark themes; Czech and English UI, detected from your locale and remembered',
    ],
    docHref: '/docs/getting-started',
    docLabel: 'Getting started',
  },
  {
    id: 'desktop',
    eyebrow: 'Optional',
    title: 'Desktop shell for locked-down tenants',
    body: 'Some tenants block the browser popup that Microsoft sign-in needs. The Electron build sidesteps that with a loopback authentication flow and adds native file dialogs.',
    points: [
      'Native file-open dialogs',
      'Loopback MSAL sign-in instead of a popup window',
      'Same UI and same parser as the web version',
    ],
    docHref: '/docs/desktop-app',
    docLabel: 'Desktop app',
  },
];

export default function FeaturesPage() {
  return (
    <>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
            { '@type': 'ListItem', position: 2, name: 'Features', item: `${siteUrl}/features` },
          ],
        }}
      />

      <section className="border-b border-border bg-bg-soft">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">Features</p>
          <h1 className="mt-3 max-w-3xl font-display text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
            Everything the ER Visualizer does
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted">
            One read-only workspace for Electronic Reporting: ingestion, visualization, search, and
            expression tracing. Each section links to the documentation page that covers it in
            depth.
          </p>

          <nav aria-label="On this page" className="mt-8 flex flex-wrap gap-2">
            {blocks.map((block) => (
              <a
                key={block.id}
                href={`#${block.id}`}
                className="rounded-full border border-border bg-surface px-3.5 py-1.5 text-sm text-muted transition-colors hover:border-accent hover:text-accent"
              >
                {block.eyebrow}
              </a>
            ))}
          </nav>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-5">
        {blocks.map((block) => (
          <section
            key={block.id}
            id={block.id}
            className="grid gap-8 border-b border-border py-14 lg:grid-cols-[1fr_1.05fr] lg:gap-16"
          >
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-accent">
                {block.eyebrow}
              </p>
              <h2 className="mt-3 font-display text-2xl font-bold tracking-tight sm:text-3xl">
                {block.title}
              </h2>
              <p className="mt-4 leading-relaxed text-muted">{block.body}</p>
              <Link
                href={block.docHref}
                className="mt-5 inline-block text-sm font-semibold text-accent hover:underline"
              >
                {block.docLabel} →
              </Link>
            </div>

            <ul className="grid content-start gap-3">
              {block.points.map((point) => (
                <li
                  key={point}
                  className="flex gap-3 rounded-lg border border-border bg-surface p-4 text-sm leading-relaxed"
                >
                  <span aria-hidden="true" className="text-accent">
                    ✓
                  </span>
                  {point}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <section>
        <div className="mx-auto max-w-6xl px-5 py-16 text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight">Try it on your own ER</h2>
          <p className="mx-auto mt-4 max-w-xl leading-relaxed text-muted">
            Export a format from your environment, drag it in, and see how far the trace goes.
          </p>
          <Link
            href={appPath}
            className="mt-8 inline-block rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-accent-contrast transition-colors hover:bg-accent-hover"
          >
            Open the app
          </Link>
        </div>
      </section>
    </>
  );
}
