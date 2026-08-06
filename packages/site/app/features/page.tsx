import type { Metadata } from 'next';
import Link from 'next/link';
import { JsonLd } from '@/components/JsonLd';
import { appPath, siteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Features',
  description:
    'Everything the D365FO ER Visualizer does: XML and live F&O ingestion, node-graph designers for data models, mappings and formats, where-used tracing, expression drill-down, Excel template preview, and an optional desktop shell.',
  alternates: { canonical: '/features' },
  openGraph: {
    title: 'Features · D365FO ER Visualizer',
    description:
      'XML and live F&O ingestion, visual designers, where-used tracing, expression drill-down, Excel template preview, and more.',
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
    body: 'Every configuration type gets a layout built for how that artifact is actually read, rendered as an interactive node graph you can pan, zoom, and expand to any depth.',
    points: [
      'Data model — containers laid out left to right with type-reference edges',
      'Model mapping — three columns: datasources, bindings, validations',
      'Format — hierarchical element tree with binding-status badges and grouped bindings',
      'Excel-based formats render the template with its original layout and named ranges',
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
      'Full-text search across data models, mappings, and formats at once',
      'Where-used returns every format binding, model binding, and datasource that references an element',
      'Results carry their source context, so you can tell duplicates apart',
      'Command palette on Ctrl/⌘+K jumps to configurations, tabs, and panel actions',
    ],
    docHref: '/docs/search-and-where-used',
    docLabel: 'Search and where-used',
  },
  {
    id: 'drill-down',
    eyebrow: 'Understanding formulas',
    title: 'Drill through an expression to its real source',
    body: 'ER formulas nest calculated fields inside calculated fields. The drill-down workbench keeps the expression on one side and its resolution on the other, so you never lose the thread.',
    points: [
      'Expression tree parsed into typed nodes — calls, conditionals, case blocks, operators',
      'Select any part of the expression to see what it resolves to',
      'Identifiers are clickable; hovering shows a tooltip card with the resolved source',
      'Keep drilling until you reach the concrete table, class, enum, or user parameter',
    ],
    docHref: '/docs/expression-drill-down',
    docLabel: 'Expression drill-down',
  },
  {
    id: 'fno',
    eyebrow: 'Live environments',
    title: 'Browse and ingest a live ER solution tree',
    body: 'Sign in with your own Entra app registration, walk the ER solution hierarchy of the environment, and pull down exactly the configurations you need — including the ones you did not know you needed.',
    points: [
      'Multi-select configurations across drill levels in one session',
      'Ancestor data models are discovered and included automatically',
      'Model mappings are fetched per data model so bindings resolve end to end',
      'Live configurations sit in the same workspace as files opened from disk',
    ],
    docHref: '/docs/connect-to-fno',
    docLabel: 'F&O connection',
  },
  {
    id: 'workspace',
    eyebrow: 'Day-to-day use',
    title: 'A workspace built for reading, not clicking',
    body: 'Tabs, a resizable layout, and a property inspector that adapts to whatever you selected — the parts you expect from an IDE, without the parts you do not need for analysis.',
    points: [
      'Tabbed designers with an explorer tree for the whole workspace',
      'Context-aware property inspector for files, containers, fields, datasources, and bindings',
      'Technical mode reveals GUIDs and raw expressions when you need the underlying detail',
      'Light and dark themes; Czech and English UI, auto-detected from your locale',
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
