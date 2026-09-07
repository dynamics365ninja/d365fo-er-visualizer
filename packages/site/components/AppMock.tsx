'use client';

import { useState } from 'react';

/**
 * Stylised illustration of the drill-down — the screen that makes the product
 * what it is. It mirrors the real dialog: the "D365FO data used" summary on top
 * and the "Value path" lineage below, with the Detail/Tree switch working.
 *
 * The panels are decorative (and marked as such); only the switch is exposed
 * to assistive tech. Unlike a screenshot, this stays theme-aware, responsive,
 * and readable at hero size.
 */

type View = 'detail' | 'tree';

/** A clickable token inside a formula — the ↓ mirrors the app's drill affordance. */
function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-0.5 whitespace-nowrap rounded-md border border-accent/25 bg-accent-soft px-1.5 py-[1px] text-accent">
      {children}
      <span aria-hidden="true" className="text-[8px] opacity-60">
        ↓
      </span>
    </span>
  );
}

/** A plain token — part of the path, but not a drill target. */
function Token({ children }: { children: React.ReactNode }) {
  return (
    <span className="whitespace-nowrap rounded border border-border bg-surface-2 px-1.5 py-[1px] text-muted">
      {children}
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

/** Small uppercase stage label, as used down the value path. */
function StageLabel({
  children,
  tone = 'muted',
}: {
  children: React.ReactNode;
  tone?: 'muted' | 'accent' | 'amber';
}) {
  const tones = {
    muted: 'border-border bg-surface-2 text-muted',
    accent: 'border-accent/30 bg-accent-soft text-accent',
    amber:
      'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  } as const;

  return (
    <span
      className={`shrink-0 rounded border px-1.5 py-[1px] text-[9px] font-bold uppercase tracking-wider ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/** One row of the lineage: stage label, the thing, and its technical detail. */
function Stage({
  label,
  tone,
  name,
  detail,
  caret,
}: {
  label: string;
  tone?: 'muted' | 'accent' | 'amber';
  name?: string;
  detail?: string;
  caret?: 'open' | 'closed';
}) {
  return (
    <div className="flex items-center gap-1.5 py-1">
      {caret && (
        <span aria-hidden="true" className="w-2 shrink-0 text-[9px] text-muted">
          {caret === 'open' ? '▾' : '▸'}
        </span>
      )}
      <StageLabel tone={tone}>{label}</StageLabel>
      {name && <span className="truncate font-mono text-[10.5px] font-semibold">{name}</span>}
      {detail && (
        <span className="truncate font-mono text-[9.5px] text-muted">{detail}</span>
      )}
    </div>
  );
}

/** Indented branch with the dashed guide line the app draws down the path. */
function Branch({ children }: { children: React.ReactNode }) {
  return (
    <div className="ml-2.5 border-l border-dashed border-border-strong pl-3">{children}</div>
  );
}

/** The chip row at the top: every D365FO object this expression finally reads. */
function SourceChip({ name, kind }: { name: string; kind: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1.5">
      <span aria-hidden="true" className="shrink-0 text-[9px] text-muted">
        ▤
      </span>
      <span className="truncate font-mono text-[10.5px] font-semibold">{name}</span>
      <span className="shrink-0 text-[8.5px] font-semibold uppercase tracking-wider text-muted">
        {kind}
      </span>
    </span>
  );
}

/** The format expression, broken down into clickable parts. */
function ExpressionBlock() {
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-bg-soft p-2.5 font-mono text-[10.5px] leading-4">
      <div className="min-w-max">
        <Line>
          <Fn>IF</Fn>
          <Punct>(</Punct>
        </Line>
        <Line indent={1}>
          <Token>model</Token>
          <Punct>.</Punct>
          <Chip>InvoiceLinesLocalization</Chip>
          <Punct>.</Punct>
          <Chip>ExternalItemId</Chip>
          <Punct>{'<> "",'}</Punct>
        </Line>
        <Line indent={1}>
          <Token>model</Token>
          <Punct>.</Punct>
          <Chip>InvoiceLinesLocalization</Chip>
          <Punct>.</Punct>
          <Chip>ExternalItemId</Chip>
          <Punct>,</Punct>
        </Line>
        <Line indent={1}>
          <Token>model</Token>
          <Punct>.</Punct>
          <Chip>InvoiceLinesLocalization</Chip>
          <Punct>.</Punct>
          <Chip>ItemId</Chip>
        </Line>
        <Line>
          <Punct>)</Punct>
        </Line>
      </div>
    </div>
  );
}

/** One resolved model path: the mapping formula behind it, and its source. */
function ModelPathBranch({
  field,
  path,
  source,
  sourceDetail,
}: {
  field: string;
  path: string;
  source: string;
  sourceDetail?: string;
}) {
  return (
    <>
      <Stage caret="open" label="Model path" name={field} detail={path} />
      <Branch>
        <Stage caret="open" label="Binding in model mapping" />
        <div className="ml-2.5 rounded-md border border-border bg-surface p-2">
          <p className="pb-1 text-[9px] font-bold uppercase tracking-wider text-muted">
            Formula
          </p>
          <div className="overflow-x-auto font-mono text-[10.5px]">
            <div className="flex min-w-max items-center gap-[3px]">
              <Chip>&apos;$SalesInvoiceLocalizationTmp_Lines&apos;</Chip>
              <Punct>.</Punct>
              <Chip>{field}</Chip>
            </div>
          </div>
        </div>
        <div className="ml-2.5 mt-1">
          <Stage caret="closed" label="Calculated field" name={source} detail={sourceDetail} />
        </div>
      </Branch>
    </>
  );
}

function DetailView() {
  return (
    <div className="space-y-3 bg-bg-soft p-3 sm:p-4">
      {/* D365FO data used */}
      <section className="rounded-xl border border-border bg-surface p-3">
        <div className="flex items-center gap-2">
          <h3 className="text-[12px] font-semibold">D365FO data used</h3>
          <span className="rounded bg-surface-2 px-1.5 py-[1px] text-[10px] font-semibold text-muted">
            4
          </span>
        </div>
        <p className="mt-1 text-[10.5px] leading-4 text-muted">
          Tables, fields and parameters this expression finally reads from. Click an item to
          reveal where it sits in the value path below.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <SourceChip name="ReportDataProvider" kind="AX class" />
          <SourceChip name="SalesInvoiceDP.getSalesInvoiceLocalizationTmp" kind="AX class" />
          <SourceChip name="$SalesInvoiceLocalizationTmp" kind="Calculated field" />
          <SourceChip name="$SalesInvoiceLocalizationTmp_Lines" kind="Calculated field" />
        </div>
      </section>

      {/* Value path */}
      <section className="rounded-xl border border-border bg-surface p-3">
        <h3 className="text-[12px] font-semibold">Value path</h3>
        <p className="mt-1 text-[10.5px] leading-4 text-muted">
          The whole chain from the format expression down to the field in D365FO. Highlighted
          parts of a formula are clickable — the path expands down to that source.
        </p>

        <div className="mt-2 rounded-lg border border-accent/30 bg-accent-soft px-2.5 py-1.5">
          <div className="flex items-center gap-1.5">
            <StageLabel tone="accent">Format expression</StageLabel>
            <span className="truncate font-mono text-[10.5px] font-semibold">
              InvoiceLines_ItemNumber_Value
            </span>
          </div>
        </div>

        <div className="mt-2 pl-2">
          <p className="pb-1 text-[9px] font-bold uppercase tracking-wider text-muted">
            Expression breakdown
          </p>
          <ExpressionBlock />

          <div className="mt-2">
            <ModelPathBranch
              field="ExternalItemId"
              path="model.InvoiceLinesLocalization.ExternalItemId"
              source="$SalesInvoiceLocalizationTmp_Lines"
              sourceDetail="WHERE( '$SalesInvoiceLocalizationTmp', … )"
            />
            <ModelPathBranch
              field="ItemId"
              path="model.InvoiceLinesLocalization.ItemId"
              source="$SalesInvoiceLocalizationTmp_Lines"
              sourceDetail="WHERE( '$SalesInvoiceLocalizationTmp', … )"
            />
          </div>
        </div>
      </section>
    </div>
  );
}

type NodeKind = 'expression' | 'model' | 'mapping' | 'calc' | 'ax';

const NODE_TONES: Record<NodeKind, { frame: string; head: string }> = {
  expression: {
    frame: 'border-accent bg-accent-soft',
    head: 'border-accent/30 bg-accent text-accent-contrast',
  },
  model: {
    frame: 'border-emerald-600/35 bg-surface',
    head: 'border-emerald-600/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  },
  mapping: {
    frame: 'border-amber-500/40 bg-surface',
    head: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  },
  calc: {
    frame: 'border-border bg-surface',
    head: 'border-border bg-surface-2 text-muted',
  },
  ax: {
    frame: 'border-teal-500/40 bg-teal-500/[0.06]',
    head: 'border-teal-500/25 bg-teal-500/10 text-teal-700 dark:text-teal-300',
  },
};

const NODE_LABELS: Record<NodeKind, string> = {
  expression: 'Expression',
  model: 'Model',
  mapping: 'Mapping',
  calc: 'Calculated field',
  ax: 'AX class',
};

/** One node of the drill-down graph, as drawn in the app's tree view. */
function GraphNode({
  kind,
  title,
  body,
  actions = [],
  active = false,
}: {
  kind: NodeKind;
  title?: string;
  body: string[];
  actions?: string[];
  active?: boolean;
}) {
  const tone = NODE_TONES[kind];

  return (
    <div
      className={`overflow-hidden rounded-lg border ${tone.frame} ${
        active ? 'ring-1 ring-accent/40' : ''
      }`}
    >
      <div
        className={`flex items-center gap-1 border-b px-2 py-[3px] text-[8.5px] font-bold uppercase tracking-wider ${tone.head}`}
      >
        <span aria-hidden="true" className="opacity-70">
          ▤
        </span>
        {NODE_LABELS[kind]}
      </div>
      <div className="px-2 py-1.5">
        {title && <p className="truncate text-[10.5px] font-semibold">{title}</p>}
        {body.length > 0 && (
          <div className="mt-0.5 overflow-hidden font-mono text-[8.5px] leading-[13px] text-muted">
            {body.map((row) => (
              <p key={row} className="truncate">
                {row}
              </p>
            ))}
          </div>
        )}
        {actions.length > 0 && (
          <div className="mt-1.5 flex gap-1">
            {actions.map((action) => (
              <span
                key={action}
                className="rounded border border-border bg-surface-2 px-1.5 py-[1px] text-[8.5px] text-muted"
              >
                {action}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Vertical edge between two stacked nodes. */
function Edge({ active = false }: { active?: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={`mx-auto h-5 w-px ${
        active ? 'bg-accent' : 'border-l border-dashed border-border-strong'
      }`}
    />
  );
}

/** One branch of the graph: model path → mapping → calculated fields. */
function GraphColumn({ field, active }: { field: string; active: boolean }) {
  return (
    <div className={active ? '' : 'opacity-55'}>
      <GraphNode
        kind="model"
        title={field}
        body={[`model.InvoiceLinesLocalization.${field}`]}
        actions={['Copy']}
        active={active}
      />
      <Edge active={active} />
      <GraphNode
        kind="mapping"
        title="Mapping"
        body={[`'$SalesInvoiceLocalizationTmp_Lines'.${field}`]}
        actions={['Copy']}
        active={active}
      />
      <Edge active={active} />
      <GraphNode
        kind="calc"
        title="$SalesInvoiceLocalizationTmp_Lines"
        body={[
          'WHERE(',
          "  '$SalesInvoiceLocalizationTmp',",
          "  AND('$SalesInvoiceLocalizationTmp'.Qty <> 0,",
          "  '$SalesInvoiceLocalizationTmp'.SalesPrice <> 0)",
          ')',
        ]}
        actions={['Copy', 'Explorer']}
        active={active}
      />
      <Edge active={active} />
      <GraphNode
        kind="calc"
        title="$SalesInvoiceLocalizationTmp"
        body={['ReportDataProvider.getSalesInvoiceLocalizationTmp']}
        actions={['Copy', 'Explorer']}
        active={active}
      />
      <Edge active={active} />
      <GraphNode
        kind="ax"
        title="ReportDataProvider"
        body={['SalesInvoiceDP.getSalesInvoiceLocalizationTmp']}
        actions={['Copy', 'Explorer']}
        active={active}
      />
      <Edge active={active} />
      <GraphNode
        kind="ax"
        title="SalesInvoiceDP.getSalesInvoiceLocalizationTmp"
        body={[]}
        active={active}
      />
    </div>
  );
}

function TreeView() {
  return (
    <div className="relative overflow-x-auto bg-bg-soft p-4 pb-10">
      <div className="mx-auto min-w-[26rem] max-w-[34rem]">
        {/* Root — the format expression being traced */}
        <div className="mx-auto w-[72%]">
          <GraphNode
            kind="expression"
            body={[
              'IF(model.InvoiceLinesLocalization.ExternalItemId<>"",',
              '  model.InvoiceLinesLocalization.ExternalItemId,',
              '  model.InvoiceLinesLocalization.ItemId)',
            ]}
            active
          />
        </div>

        {/* Fork: the expression resolves to two model paths. */}
        <div aria-hidden="true" className="mx-auto h-4 w-px bg-accent" />
        <div aria-hidden="true" className="mx-auto flex w-1/2">
          <div className="h-0 flex-1 border-t border-dashed border-border-strong" />
          <div className="h-0 flex-1 border-t border-accent" />
        </div>
        <div aria-hidden="true" className="grid grid-cols-2">
          <div className="mx-auto h-4 w-px border-l border-dashed border-border-strong" />
          <div className="mx-auto h-4 w-px bg-accent" />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          <GraphColumn field="ExternalItemId" active={false} />
          <GraphColumn field="ItemId" active />
        </div>
      </div>

      {/* Pan/zoom controls, as in the app's tree canvas. */}
      <div
        aria-hidden="true"
        className="absolute bottom-3 left-3 flex flex-col overflow-hidden rounded-md border border-border bg-surface"
      >
        {['+', '−', '⤢'].map((glyph) => (
          <span
            key={glyph}
            className="flex h-5 w-5 items-center justify-center border-b border-border text-[10px] text-muted last:border-b-0"
          >
            {glyph}
          </span>
        ))}
      </div>
    </div>
  );
}

export function AppMock() {
  const [view, setView] = useState<View>('detail');

  const tab = (value: View, label: string) => (
    <button
      type="button"
      onClick={() => setView(value)}
      aria-pressed={view === value}
      className={`rounded px-2 py-1 text-[10px] font-semibold transition-colors ${
        view === value ? 'bg-accent text-accent-contrast' : 'text-muted hover:text-text'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div
      role="group"
      aria-label="Illustration of the drill-down — switch between the detail and tree view"
      className="overflow-hidden rounded-xl border border-border bg-surface shadow-[0_24px_60px_-30px_rgba(0,0,0,0.45)]"
    >
      {/* Dialog title bar */}
      <div className="flex items-center gap-2.5 border-b border-border bg-surface px-4 py-3">
        <span aria-hidden="true" className="h-3 w-3 rounded-full border-2 border-muted" />
        <span aria-hidden="true" className="font-display text-sm font-bold">
          InvoiceLines_ItemNumber_Value
        </span>
        <span
          aria-hidden="true"
          className="ml-auto flex h-5 w-5 items-center justify-center rounded border border-border text-[11px] text-muted"
        >
          ✕
        </span>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-4 py-2">
        <span
          aria-hidden="true"
          className="rounded bg-accent px-2 py-[3px] text-[10px] font-semibold uppercase tracking-wider text-accent-contrast"
        >
          Drill-down
        </span>
        <span
          aria-hidden="true"
          className="hidden max-w-[16rem] truncate rounded border border-border bg-surface px-2 py-[3px] text-[10px] text-muted sm:inline-block"
        >
          InvoiceLines_ItemNumber_Value
        </span>

        <div className="ml-auto flex items-center gap-2">
          {view === 'tree' && (
            <div
              aria-hidden="true"
              className="hidden items-center gap-1 md:flex"
            >
              <div className="flex items-center gap-1 rounded-md border border-border bg-surface p-0.5">
                <span className="px-2 py-1 text-[10px] text-muted">Compact</span>
                <span className="rounded bg-accent px-2 py-1 text-[10px] font-semibold text-accent-contrast">
                  Full
                </span>
              </div>
              <span className="rounded-md border border-border bg-surface px-2 py-[5px] text-[10px] text-muted">
                Unresolved
              </span>
            </div>
          )}
          <div className="flex items-center gap-1 rounded-md border border-border bg-surface p-0.5">
            {tab('detail', 'Detail')}
            {tab('tree', 'Tree')}
          </div>
        </div>
      </div>

      <div aria-hidden="true">{view === 'detail' ? <DetailView /> : <TreeView />}</div>
    </div>
  );
}
