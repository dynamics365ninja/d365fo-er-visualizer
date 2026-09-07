'use client';

import { useState } from 'react';

/**
 * Stylised illustration of the drill-down — the screen that makes the product
 * what it is. The dropdown really works, so the hero can show either of the
 * views the app offers: the "Value path" lineage outline that's open in the
 * app today, or the node-graph designer view.
 *
 * The panels are decorative (and marked as such); only the dropdown is
 * exposed to assistive tech. Unlike a screenshot, this stays theme-aware,
 * responsive, and readable at hero size.
 */

type View = 'lineage' | 'graph';

const VIEW_LABELS: Record<View, string> = {
  lineage: 'Value path (drill-down)',
  graph: 'Node graph (designer)',
};

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-accent/25 bg-accent-soft px-1.5 py-[1px] text-accent">
      {children}
      <span aria-hidden="true" className="text-[8px] opacity-60">
        ↗
      </span>
    </span>
  );
}

function Fn({ children }: { children: React.ReactNode }) {
  return <span className="font-semibold text-accent">{children}</span>;
}

function Punct({ children }: { children: React.ReactNode }) {
  return <span className="text-muted">{children}</span>;
}

/** One line of the expression. `indent` is in 0.75rem steps, as in the app. */
function Line({ indent = 0, children }: { indent?: number; children: React.ReactNode }) {
  return (
    <div
      className="flex items-center gap-[3px] whitespace-nowrap py-[2px]"
      style={{ paddingLeft: `${indent * 0.75}rem` }}
    >
      {children}
    </div>
  );
}

function ExpressionBlock() {
  return (
    <div className="overflow-x-auto rounded-md bg-bg-soft p-2.5 font-mono text-[10.5px] leading-4">
      <div className="min-w-max">
        <Line>
          <Fn>LISTJOIN</Fn>
          <Punct>(</Punct>
        </Line>
        <Line indent={1}>
          <Fn>WHERE</Fn>
          <Punct>(</Punct>
        </Line>
        <Line indent={2}>
          <Chip>&apos;Control statement&apos;</Chip>
          <Punct>.</Punct>
          <Chip>&apos;$A4A5Docs&apos;</Chip>
          <Punct>,</Punct>
        </Line>
        <Line indent={2}>
          <Fn>ABS</Fn>
          <Punct>(</Punct>
        </Line>
        <Line indent={3}>
          <Chip>&apos;$A4A5Docs&apos;</Chip>
          <Punct>.</Punct>
          <Chip>aggregated</Chip>
          <Punct>.</Punct>
          <Chip>&apos;$TotalBasePlusTax&apos;</Chip>
        </Line>
        <Line indent={2}>
          <Punct>{') >'}</Punct>
          <Chip>Parameters</Chip>
          <Punct>.</Punct>
          <Chip>&apos;$Threshold&apos;</Chip>
        </Line>
        <Line indent={1}>
          <Punct>),</Punct>
        </Line>
        <Line indent={1}>
          <Chip>&apos;Control statement&apos;</Chip>
          <Punct>.</Punct>
          <Chip>&apos;$A4DocsBadDebts&apos;</Chip>
        </Line>
        <Line>
          <Punct>)</Punct>
        </Line>
      </div>
    </div>
  );
}

/** A stage badge, matching the wording used in the app's real lineage outline. */
function StageBadge({ tone, children }: { tone: 'model' | 'mapping' | 'source' | 'formula' | 'entity'; children: React.ReactNode }) {
  const toneClass: Record<typeof tone, string> = {
    model: 'border-accent/30 bg-accent-soft text-accent',
    mapping: 'border-border-strong bg-surface-2 text-muted',
    source: 'border-emerald-600/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    formula: 'border-emerald-600/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    entity: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  };
  return (
    <span
      className={`shrink-0 rounded border px-1.5 py-[1px] text-[9px] font-medium uppercase tracking-wider ${toneClass[tone]}`}
    >
      {children}
    </span>
  );
}

/** One row of the "Value path" outline, indented like the real drill-down tree. */
function LineageRow({
  indent = 0,
  stage,
  name,
  sub,
  active,
}: {
  indent?: number;
  stage: 'model' | 'mapping' | 'source' | 'formula' | 'entity';
  name: string;
  sub?: string;
  active?: boolean;
}) {
  const stageLabel: Record<typeof stage, string> = {
    model: 'Model path',
    mapping: 'Binding in model mapping',
    source: 'Data source',
    formula: 'Calculated field',
    entity: 'AX object',
  };
  return (
    <div
      className={`flex items-center gap-1.5 rounded-md px-1.5 py-1 ${
        active ? 'bg-accent-soft ring-1 ring-inset ring-accent/25' : ''
      }`}
      style={{ marginLeft: `${indent * 0.9}rem` }}
    >
      <StageBadge tone={stage}>{stageLabel[stage]}</StageBadge>
      <span className="truncate font-mono text-[10.5px] font-semibold">{name}</span>
      {sub && <span className="truncate font-mono text-[9.5px] text-muted">{sub}</span>}
    </div>
  );
}

function LineageView() {
  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* D365FO data used */}
      <div className="border-b border-border p-3 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between px-1 pb-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
            D365FO data used
          </p>
          <span className="rounded border border-border px-1.5 py-[1px] text-[9px] text-muted">
            5
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5 px-1">
          <Chip>$A4A5Docs</Chip>
          <Chip>aggregated.&apos;$TotalBasePlusTax&apos;</Chip>
          <Chip>$Threshold</Chip>
          <Chip>$NoTaxDocumentEnum</Chip>
          <Chip>$A4DocsBadDebts</Chip>
        </div>

        <p className="mt-3 rounded-lg border border-accent/30 bg-accent-soft px-2.5 py-2 text-[10px] leading-4 text-muted">
          <span className="font-semibold text-accent">Selected part of the expression: </span>
          &apos;Control statement&apos;.&apos;$A4Docs&apos; — click any part of a formula to drill
          into it.
        </p>
      </div>

      {/* Value path */}
      <div className="bg-bg-soft p-3">
        <p className="px-1 pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
          Value path
        </p>

        <div className="space-y-0.5">
          <LineageRow stage="model" name="$A4Docs" sub="'Control statement'.'$A4Docs'" active />
          <LineageRow indent={1} stage="mapping" name="LISTJOIN( WHERE(…), … )" />
          <LineageRow indent={2} stage="source" name="$A4A5Docs" />
          <LineageRow indent={2} stage="formula" name="$Threshold" sub="User parameter" />
          <LineageRow indent={3} stage="entity" name="$NoTaxDocumentEnum" sub="NoTaxDocument" />
          <LineageRow indent={2} stage="source" name="$A4DocsBadDebts" />
        </div>

        <div className="mt-3 border-t border-border pt-2">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
            <span aria-hidden="true" className="text-accent">
              ▤
            </span>
            Full formula
          </p>
          <div className="mt-2">
            <ExpressionBlock />
          </div>
        </div>
      </div>
    </div>
  );
}

/** A leaf node in the tree view: a datasource or an enum. */
function TreeLeaf({
  kind,
  name,
  sub,
  actions,
}: {
  kind: 'DS' | 'Enum';
  name: string;
  sub?: string;
  actions: string[];
}) {
  const isEnum = kind === 'Enum';

  return (
    <div className="relative w-[8.5rem] shrink-0">
      {/* Stub connecting the card up to the horizontal rule. */}
      <div
        aria-hidden="true"
        className="mx-auto hidden h-3 w-px border-l border-dashed border-border-strong sm:block"
      />
      <div
        className={`overflow-hidden rounded-xl border ${
          isEnum ? 'border-amber-500/40' : 'border-border'
        } bg-surface`}
      >
        <div
          className={`flex items-center gap-1 border-b px-2 py-1 text-[9px] font-bold uppercase tracking-wider ${
            isEnum
              ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
              : 'border-border bg-surface-2 text-muted'
          }`}
        >
          {kind}
        </div>
        <div className="px-2 py-1.5">
          <p className="truncate font-mono text-[10.5px] font-semibold">{name}</p>
          {sub && <p className="mt-0.5 truncate font-mono text-[9px] text-muted">{sub}</p>}
          <div className="mt-1.5 flex gap-1">
            {actions.map((action) => (
              <span
                key={action}
                className="rounded border border-border px-1.5 py-[1px] text-[9px] text-muted"
              >
                {action}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function TreeView() {
  return (
    <div className="bg-bg-soft p-4">
      <div className="flex flex-col items-center">
        {/* Root — the expression being traced */}
        <div className="w-[15rem] overflow-hidden rounded-xl border border-accent bg-accent text-accent-contrast">
          <div className="border-b border-white/20 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider opacity-80">
            Expression
          </div>
          <p className="truncate px-2.5 py-1.5 font-mono text-[10.5px]">
            &apos;Control statement&apos;.&apos;$A4Docs&apos;
          </p>
        </div>

        <div
          aria-hidden="true"
          className="h-5 w-px border-l border-dashed border-border-strong"
        />

        {/* Calculation behind it */}
        <div className="w-full max-w-[26rem] overflow-hidden rounded-xl border border-border bg-surface">
          <div className="flex items-center gap-1.5 border-b border-border bg-surface-2 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-muted">
            <span aria-hidden="true" className="text-accent">
              ▤
            </span>
            Calculation
          </div>
          <div className="p-2.5">
            <p className="font-mono text-[11px] font-semibold">$A4Docs</p>
            <div className="mt-1.5 overflow-x-auto font-mono text-[9.5px] leading-4 text-muted">
              <div className="min-w-max">
                <p>LISTJOIN(</p>
                <p className="pl-3">WHERE(&apos;Control statement&apos;.&apos;$A4A5Docs&apos;,</p>
                <p className="pl-6">ABS(…&apos;$TotalBasePlusTax&apos;) &gt; Parameters.&apos;$Threshold&apos;),</p>
                <p className="pl-3">&apos;Control statement&apos;.&apos;$A4DocsBadDebts&apos;)</p>
              </div>
            </div>
            <div className="mt-2 flex gap-1">
              <span className="rounded border border-border px-1.5 py-[1px] text-[9px] text-muted">
                Drill
              </span>
              <span className="rounded border border-border px-1.5 py-[1px] text-[9px] text-muted">
                Copy
              </span>
            </div>
          </div>
        </div>

        <div
          aria-hidden="true"
          className="h-5 w-px border-l border-dashed border-border-strong"
        />

        {/* Leaves — where the value actually comes from */}
        <div
          aria-hidden="true"
          className="hidden h-px w-full max-w-[46rem] border-t border-dashed border-border-strong sm:block"
        />
        <div className="flex w-full flex-wrap justify-center gap-2 sm:gap-3">
          <TreeLeaf kind="DS" name="$A4A5Docs" actions={['Drill', 'Copy']} />
          <TreeLeaf
            kind="DS"
            name="aggregated"
            sub="'$TotalBasePlusTax'"
            actions={['Drill', 'Copy']}
          />
          <TreeLeaf kind="DS" name="$Threshold" actions={['Drill', 'Copy']} />
          <TreeLeaf
            kind="Enum"
            name="$NoTaxDocumentEnum"
            sub="NoTaxDocument"
            actions={['Drill', 'Explorer']}
          />
          <TreeLeaf kind="DS" name="$A4DocsBadDebts" actions={['Drill', 'Copy']} />
        </div>
      </div>
    </div>
  );
}

export function AppMock() {
  const [view, setView] = useState<View>('lineage');

  return (
    <div
      role="group"
      aria-label="Illustration of the drill-down — pick a view from the dropdown"
      className="overflow-hidden rounded-xl border border-border bg-surface shadow-[0_24px_60px_-30px_rgba(0,0,0,0.45)]"
    >
      {/* Dialog header */}
      <div className="flex items-center gap-3 border-b border-border bg-surface-2 px-4 py-3">
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full border-2 border-muted" />
        <span aria-hidden="true" className="font-display text-sm font-bold">
          VetaA4
        </span>
        <span
          aria-hidden="true"
          className="ml-2 hidden rounded bg-accent px-2 py-[3px] text-[10px] font-semibold uppercase tracking-wider text-accent-contrast sm:inline"
        >
          Drill-down
        </span>

        <div className="relative ml-auto">
          <label className="sr-only" htmlFor="app-mock-view">
            View
          </label>
          <select
            id="app-mock-view"
            value={view}
            onChange={(event) => setView(event.target.value as View)}
            className="cursor-pointer appearance-none rounded-md border border-border bg-surface py-1 pl-2.5 pr-6 text-[10px] font-semibold text-text"
          >
            {(Object.keys(VIEW_LABELS) as View[]).map((value) => (
              <option key={value} value={value}>
                {VIEW_LABELS[value]}
              </option>
            ))}
          </select>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[8px] text-muted"
          >
            ▾
          </span>
        </div>
      </div>

      <div aria-hidden="true">{view === 'lineage' ? <LineageView /> : <TreeView />}</div>
    </div>
  );
}
