'use client';

import { useState } from 'react';

/**
 * Stylised illustration of the drill-down — the screen that makes the product
 * what it is. The Workbench/Tree switch really works, so the hero shows both
 * of the views the app offers.
 *
 * The panels are decorative (and marked as such); only the switch is exposed
 * to assistive tech. Unlike a screenshot, this stays theme-aware, responsive,
 * and readable at hero size.
 */

type View = 'workbench' | 'tree';

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

function WorkbenchView() {
  return (
    <div className="grid lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)]">
      {/* Expression parts */}
      <div className="border-b border-border p-3 lg:border-b-0 lg:border-r">
        <p className="px-1 pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
          Expression parts
        </p>

        <div className="rounded-lg border border-accent/30 bg-accent-soft px-2.5 py-2">
          <p className="text-[12px] font-semibold">VetaA4</p>
          <p className="mt-0.5 truncate font-mono text-[10px] text-muted">
            &apos;Control statement&apos;.&apos;$A4Docs&apos;
          </p>
        </div>

        <div className="mt-1.5 rounded-lg px-2.5 py-2 pl-5">
          <p className="truncate font-mono text-[11px]">&apos;Control statement&apos;</p>
          <p className="mt-0.5 truncate font-mono text-[10px] text-muted">
            &apos;Control statement&apos;
          </p>
        </div>
      </div>

      {/* Selected part resolution */}
      <div className="bg-bg-soft p-3">
        <p className="px-1 pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
          Selected part resolution
        </p>

        <p className="px-1 text-[10px] font-medium uppercase tracking-wider text-muted">
          Current branch
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 px-1 font-mono text-[10.5px]">
          <span className="rounded border border-border bg-surface px-1.5 py-[2px] text-muted">
            &apos;Control statement&apos;
          </span>
          <Punct>›</Punct>
          <span className="rounded border border-accent/30 bg-accent-soft px-1.5 py-[2px] text-accent">
            &apos;$A4Docs&apos;
          </span>
        </div>

        <div className="mt-3 rounded-lg border border-border bg-surface p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] font-semibold">Data source</span>
            <span className="rounded border border-emerald-600/25 bg-emerald-500/10 px-2 py-[2px] text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
              Calculation
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 text-[11px]">
            <span className="text-muted">Name</span>
            <span className="font-mono font-semibold">$A4Docs</span>
          </div>

          <div className="mt-3 border-t border-border pt-3">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
              <span aria-hidden="true" className="text-accent">
                ▤
              </span>
              Value calculation — click to continue
            </p>
            <div className="mt-2">
              <ExpressionBlock />
            </div>
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
  const [view, setView] = useState<View>('workbench');

  const tab = (value: View, label: string) => (
    <button
      type="button"
      onClick={() => setView(value)}
      aria-pressed={view === value}
      className={`rounded px-2 py-1 text-[10px] font-semibold transition-colors ${
        view === value
          ? 'bg-accent text-accent-contrast'
          : 'text-muted hover:text-text'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div
      role="group"
      aria-label="Illustration of the drill-down — switch between the workbench and tree view"
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
          className="ml-2 rounded bg-accent px-2 py-[3px] text-[10px] font-semibold uppercase tracking-wider text-accent-contrast"
        >
          Drill-down
        </span>
        <span
          aria-hidden="true"
          className="hidden rounded border border-border bg-surface px-2 py-[3px] text-[10px] text-muted sm:inline"
        >
          1 step
        </span>

        <div className="ml-auto flex items-center gap-2">
          {view === 'tree' && (
            <div
              aria-hidden="true"
              className="hidden items-center gap-1 rounded-md border border-border bg-surface p-0.5 md:flex"
            >
              <span className="px-2 py-1 text-[10px] text-muted">Compact</span>
              <span className="rounded bg-accent px-2 py-1 text-[10px] font-semibold text-accent-contrast">
                Full
              </span>
            </div>
          )}
          <div className="flex items-center gap-1 rounded-md border border-border bg-surface p-0.5">
            {tab('workbench', 'Workbench')}
            {tab('tree', 'Tree')}
          </div>
        </div>
      </div>

      <div aria-hidden="true">{view === 'workbench' ? <WorkbenchView /> : <TreeView />}</div>
    </div>
  );
}
