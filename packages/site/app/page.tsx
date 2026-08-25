import type { Metadata } from 'next';
import Link from 'next/link';
import { AppMock } from '@/components/AppMock';
import { JsonLd } from '@/components/JsonLd';
import { appPath, repoUrl, siteDescription, siteName, siteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: `${siteName} — Visualize Electronic Reporting configurations`,
  description: siteDescription,
  alternates: { canonical: '/' },
};

const componentTypes = [
  {
    accent: 'text-model',
    ring: 'border-model/40',
    label: 'Data model',
    subtitle: 'The shared vocabulary',
    description:
      'Defines what data the configuration processes — records, lists, enumeration values and their fields. It is the common foundation that mappings and formats both connect to.',
  },
  {
    accent: 'text-mapping',
    ring: 'border-mapping/40',
    label: 'Model mapping',
    subtitle: 'Where the data comes from',
    description:
      'Determines where model data is read from — tables, views, classes, enums, user parameters, or calculated fields inside Dynamics 365 Finance & Operations.',
  },
  {
    accent: 'text-format',
    ring: 'border-format/40',
    label: 'Format',
    subtitle: 'What the output looks like',
    description:
      'Describes the structure of the generated or consumed file — XML, Excel, Word, PDF, CSV, or plain text. Every element can carry a formula bound to mapping data.',
  },
];

const features = [
  {
    title: 'XML and live ingestion',
    body: 'Drag ER XML bundles onto the page, or sign in to a Finance & Operations environment and pull configurations directly through the ER custom services.',
    href: '/docs/loading-configurations',
  },
  {
    title: 'Visual designers',
    body: 'Node-graph views for data models, model mappings, and formats — containers, datasources, bindings, and validations laid out so the structure is visible at a glance.',
    href: '/docs/designers',
  },
  {
    title: 'Search and where-used',
    body: 'Full-text search across every loaded configuration, plus a reverse trace that lists every format binding, model binding, and datasource referencing an element.',
    href: '/docs/search-and-where-used',
  },
  {
    title: 'Expression drill-down',
    body: 'Split workbench: the expression tree on the left, its resolution on the right. Identifiers inside ER formulas are hyperlinks with a tooltip card for the resolved source, so you click through calculated fields to the concrete table, class, or enum instead of copying GUIDs between files.',
    href: '/docs/expression-drill-down',
  },
  {
    title: 'Excel and PDF preview',
    body: 'Formats built on Excel templates render with their original layout and named ranges — click a cell to jump to the element bound to it. PDF formats preview the component they convert.',
    href: '/docs/designers',
  },
  {
    title: 'Readable labels',
    body: 'ER stores names as label references. The visualizer pools the dictionaries of everything loaded — and the ones it passes on the way to ancestor models — so models and mappings read in words, not ids.',
    href: '/docs/designers',
  },
  {
    title: 'Workspace and recents',
    body: 'See exactly what is loaded, grouped by data model, and add or close entries one at a time. Files are cached in your browser, so a previous file or a whole session re-opens in one click.',
    href: '/docs/loading-configurations',
  },
  {
    title: 'F&O server browser',
    body: 'Browse the ER solution hierarchy of a live environment, multi-select configurations across drill levels, and ingest them in one pass. Ancestor data models are pulled in automatically.',
    href: '/docs/connect-to-fno',
  },
  {
    title: 'Desktop shell',
    body: 'An optional Electron build adds native file dialogs and loopback MSAL sign-in for tenants where browser popups are blocked.',
    href: '/docs/desktop-app',
  },
];

const steps = [
  {
    title: 'Load your configurations',
    body: 'Drag ER XML files from disk, or connect to a D365 F&O server and download them online. Loading all three component types — model, mapping, and format — gives the most complete traceability.',
  },
  {
    title: 'Explore the hierarchy',
    body: 'The Explorer panel shows the full structure of everything you loaded. Click to select an element; double-click to open its visualization in a new tab.',
  },
  {
    title: 'Drill into expressions',
    body: 'Click a formula in the format or mapping view. Pick expression parts on the left and inspect how each resolves on the right, then keep digging until you reach the final source.',
  },
  {
    title: 'Trace where-used',
    body: 'Search for a table such as TaxTrans and run “Where used”. Every format element that consumes data from it appears in one list.',
  },
];

const faqs = [
  {
    q: 'Does the visualizer modify my ER configurations?',
    a: 'No. It is a read-only analyzer. Files loaded from disk are parsed in your browser, and configurations pulled from Finance & Operations are downloaded only — nothing is ever written back to the environment.',
  },
  {
    q: 'Are my ER files uploaded to a server?',
    a: 'No. Parsing happens entirely in your browser and XML files you drag in never leave your machine. So the app can offer you a recent file or session again, their content is cached in your own browser — you can clear it from the landing page at any time, and it is never uploaded. When you use the live connection, requests to your Finance & Operations environment are relayed through this site\'s own stateless proxy (F&O does not send CORS headers); it forwards your bearer token and the response and stores nothing.',
  },
  {
    q: 'Which ER component types are supported?',
    a: 'Data models, model mappings, and formats — including ErFnoBundle exports, bare-content files, and base64-wrapped payloads, with the correct version node resolved automatically.',
  },
  {
    q: 'Do I need a Finance & Operations connection to use it?',
    a: 'No. Exported ER XML files work standalone. The live connection is a convenience for pulling configurations without exporting them by hand first.',
  },
  {
    q: 'What is required to connect to a live environment?',
    a: 'An Entra ID application registration with delegated permission to your F&O environment and public client flows enabled, plus your environment URL, tenant ID, and client ID. The documentation walks through the registration step by step.',
  },
  {
    q: 'Is it free?',
    a: 'Yes. The project is open source under the MIT license, and the hosted web version is free to use.',
  },
];

export default function HomePage() {
  return (
    <>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'SoftwareApplication',
          name: siteName,
          applicationCategory: 'DeveloperApplication',
          applicationSubCategory: 'Business intelligence and ERP tooling',
          operatingSystem: 'Web browser, Windows, macOS, Linux',
          url: siteUrl,
          description: siteDescription,
          license: 'https://opensource.org/licenses/MIT',
          isAccessibleForFree: true,
          offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
          codeRepository: repoUrl,
          softwareHelp: `${siteUrl}/docs`,
        }}
      />
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: faqs.map((faq) => ({
            '@type': 'Question',
            name: faq.q,
            acceptedAnswer: { '@type': 'Answer', text: faq.a },
          })),
        }}
      />

      {/* ── Hero ── */}
      <section className="border-b border-border bg-gradient-to-b from-accent-soft/60 to-bg">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
          <p className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            Open source · Your data stays in your browser
          </p>

          <h1 className="mt-6 max-w-3xl font-display text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">
            Understand D365FO Electronic Reporting configurations in minutes
          </h1>

          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted">
            Load ER XML bundles or connect to a live Finance &amp; Operations environment, then
            trace any format binding through the model mapping down to the table, class, or enum it
            actually reads.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href={appPath}
              className="rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-accent-contrast transition-colors hover:bg-accent-hover"
            >
              Open the app
            </Link>
            <Link
              href="/docs/getting-started"
              className="rounded-lg border border-border-strong px-6 py-3 text-sm font-semibold transition-colors hover:bg-surface-2"
            >
              Read the documentation
            </Link>
          </div>

          <p className="mt-5 text-sm text-muted">
            No installation · No sign-up · Your files are never uploaded
          </p>

          <div className="mt-14">
            <AppMock />
          </div>
        </div>
      </section>

      {/* ── Problem ── */}
      <section className="border-b border-border">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 lg:grid-cols-2 lg:gap-16">
          <div>
            <h2 className="font-display text-3xl font-bold tracking-tight">
              GUID matching is not analysis
            </h2>
            <p className="mt-5 leading-relaxed text-muted">
              ER configurations are large, deeply nested XML documents. Tracing one format element
              back to a concrete D365FO table means opening the format, the model mapping, and the
              data model side by side — then matching GUIDs by hand and hoping you did not lose your
              place.
            </p>
            <p className="mt-4 leading-relaxed text-muted">
              The visualizer parses the whole bundle, merges cross-references across every loaded
              configuration into a single index, and turns that index into something you can click
              through. What used to be a twenty-minute archaeology session becomes a few seconds.
            </p>
          </div>

          <ul className="grid gap-4 self-start">
            {[
              ['Before', 'Open three XML files, search for a GUID, scroll, repeat.'],
              ['After', 'Click the binding. See the datasource. Keep drilling.'],
              [
                'Where-used',
                'One query lists every element that consumes the table you are changing.',
              ],
            ].map(([label, text]) => (
              <li key={label} className="rounded-xl border border-border bg-surface p-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-accent">{label}</p>
                <p className="mt-2 text-sm leading-relaxed text-muted">{text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Component types ── */}
      <section className="border-b border-border bg-bg-soft">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="font-display text-3xl font-bold tracking-tight">
            All three ER component types, in one workspace
          </h2>
          <p className="mt-4 max-w-2xl leading-relaxed text-muted">
            Electronic Reporting splits a solution across three artifacts. Load them together and
            the visualizer stitches them back into one navigable graph.
          </p>

          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {componentTypes.map((type) => (
              <article
                key={type.label}
                className={`rounded-xl border ${type.ring} bg-surface p-6`}
              >
                <p className={`font-mono text-xs ${type.accent}`}>{type.subtitle}</p>
                <h3 className="mt-2 font-display text-xl font-bold">{type.label}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted">{type.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="font-display text-3xl font-bold tracking-tight">What you get</h2>

          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((feature) => (
              <Link
                key={feature.title}
                href={feature.href}
                className="group rounded-xl border border-border bg-surface p-5 transition-colors hover:border-accent"
              >
                <h3 className="font-display text-base font-bold group-hover:text-accent">
                  {feature.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{feature.body}</p>
              </Link>
            ))}
          </div>

          <Link
            href="/features"
            className="mt-8 inline-block text-sm font-semibold text-accent hover:underline"
          >
            See all features →
          </Link>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="border-b border-border bg-bg-soft">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="font-display text-3xl font-bold tracking-tight">How it works</h2>

          <ol className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, index) => (
              <li key={step.title} className="rounded-xl border border-border bg-surface p-6">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft font-mono text-sm font-semibold text-accent">
                  {index + 1}
                </span>
                <h3 className="mt-4 font-display text-base font-bold">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Privacy ── */}
      <section className="border-b border-border">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
          <div>
            <h2 className="font-display text-3xl font-bold tracking-tight">
              Your configurations stay yours
            </h2>
            <p className="mt-5 leading-relaxed text-muted">
              Every XML file you open is parsed by code running in your own browser tab. There is no
              upload, no account, and no server-side storage of configuration content. What you
              load is cached in your own browser so recent files and sessions can be re-opened —
              local to your machine, and clearable from the landing page.
            </p>
            <p className="mt-4 leading-relaxed text-muted">
              The live F&amp;O connection signs you in with your own Entra application registration
              using the standard Microsoft authentication library. Because Finance &amp; Operations
              does not send CORS headers, those API calls pass through a stateless proxy that only
              forwards to <code className="font-mono text-sm">*.dynamics.com</code> hosts and keeps
              nothing.
            </p>
            <Link
              href="/docs/connect-to-fno"
              className="mt-6 inline-block text-sm font-semibold text-accent hover:underline"
            >
              How the connection works →
            </Link>
          </div>

          <ul className="grid gap-3 self-start">
            {[
              'Read-only — nothing is written back to your environment',
              'No account, no telemetry, no configuration content stored',
              'Sign-in uses your own Entra app registration and your own permissions',
              'MIT licensed — audit or self-host the whole stack',
            ].map((item) => (
              <li
                key={item}
                className="flex gap-3 rounded-lg border border-border bg-surface p-4 text-sm leading-relaxed"
              >
                <span aria-hidden="true" className="text-accent">
                  ✓
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="border-b border-border bg-bg-soft">
        <div className="mx-auto max-w-3xl px-5 py-16">
          <h2 className="font-display text-3xl font-bold tracking-tight">
            Frequently asked questions
          </h2>

          <div className="mt-8 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {faqs.map((faq) => (
              <details key={faq.q} className="group p-5 open:bg-surface-2">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display text-base font-semibold">
                  {faq.q}
                  <span
                    aria-hidden="true"
                    className="shrink-0 text-muted transition-transform group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-muted">{faq.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section>
        <div className="mx-auto max-w-6xl px-5 py-20 text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Open an ER configuration and see for yourself
          </h2>
          <p className="mx-auto mt-4 max-w-xl leading-relaxed text-muted">
            Nothing to install. Drag in an exported ER XML file and start clicking.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              href={appPath}
              className="rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-accent-contrast transition-colors hover:bg-accent-hover"
            >
              Open the app
            </Link>
            <a
              href={repoUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-lg border border-border-strong px-6 py-3 text-sm font-semibold transition-colors hover:bg-surface-2"
            >
              View on GitHub
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
