<script lang="ts">
  import { app, rowKind, type RowKind } from '../lib/store.svelte';
  import { isErr } from '../lib/evaluate';
  import { formatNumber, parseNumber } from '../lib/format';
  import type { DataTable } from '../lib/model';
  import { addMonths, currentMonth, monthLabel, monthRange, parseMonth } from '../lib/months';
  import { pickImportFile } from '../lib/commands';
  import SourcePicker from './SourcePicker.svelte';
  import ColumnFormat from './ColumnFormat.svelte';
  import HighlightRules from './HighlightRules.svelte';
  import SortFilter from './SortFilter.svelte';
  import { COLUMN_TYPE_LABELS } from '../lib/columns';
  import type { ColumnType } from '../lib/model';

  const t = $derived(app.table(app.focusTableId));
  const cellSel = $derived(app.selectedCell());
  const rowSel = $derived(app.selection && app.selection.anchor.c === 0 ? app.selectedRow() : null);
  const colSel = $derived.by(() => {
    const sel = app.selection;
    if (!sel || t?.kind !== 'table') return null;
    const c = sel.anchor.c;
    return t.columns[c] ? { index: c, col: t.columns[c] } : null;
  });
  const footSel = $derived(app.selectedFooter());
  const ro = $derived(app.readonly);
  const monthOptions = $derived(monthRange(addMonths(currentMonth(), -24), app.months[app.months.length - 1]));
  const fmtTime = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });

  const label = (k: string) => `${monthLabel(k)} ${parseMonth(k).year}`;
  const value = (e: Event) => (e.target as HTMLInputElement).value;

  function setOpening(e: Event) {
    const el = e.target as HTMLInputElement;
    if (t?.kind !== 'cashflow') return;
    const n = parseNumber(el.value);
    if (n === undefined) {
      app.flashNotice(`Not a number: "${el.value}"`);
      el.value = formatNumber(t.openingBalance);
      return;
    }
    app.updateCashTable(t.id, { openingBalance: n ?? 0 });
    el.value = formatNumber(n ?? 0);
  }

  /** First error a formula gives in the visible months, if any. */
  function formulaError(get: (m: string) => unknown, formula: string): string | null {
    const syntax = app.ev.check(formula);
    if (syntax) return syntax;
    for (const m of app.months) {
      const v = get(m);
      if (isErr(v as never)) return (v as { err: string }).err;
    }
    return null;
  }

  const KINDS: { kind: RowKind; label: string }[] = [
    { kind: 'manual', label: 'Manual' },
    { kind: 'source', label: 'From table' },
    { kind: 'formula', label: 'Formula' },
  ];
</script>

<!-- Docked when wide; an overlay from the trailing edge when regular; a bottom sheet when compact.
     It shows the Inspector or, from the toolbar's Filter button, Sort & Filter (like Numbers' sidebar). -->
<aside class="inspector" class:overlay={app.sizeClass === 'regular'} class:sheet={app.sizeClass === 'compact'}
  aria-label={app.panel === 'filter' ? 'Sort and filter' : 'Inspector'}>
  {#if app.panel === 'filter'}
    {#if t?.kind === 'table'}
      <div class="ptitle">Sort &amp; Filter <span>{t.name}</span></div>
      <SortFilter table={t} {ro} />
    {:else}
      <div class="ptitle">Sort &amp; Filter</div>
      <p class="hint">{t ? 'A cashflow follows its months, so it can’t be sorted or filtered. Select a table.' : 'Select a table to sort or filter its rows.'}</p>
    {/if}
  {:else if !t}
    <h3>File</h3>
    <label>
      Sync every (minutes)
      <input type="number" min="1" max="1440" value={app.wb.settings.syncMinutes} disabled={ro}
        onchange={(e) => app.setSyncMinutes(Number(value(e)) || 15)} />
    </label>
    <p class="hint">
      {#if ro}Snapshots don't sync.{:else if app.syncLeader}This window runs the sync{app.lastSyncAt ? ` (last check ${fmtTime.format(app.lastSyncAt)})` : ''}.{:else}Another window with this file open runs the sync.{/if}
    </p>
  {:else}
    <div class="segmented tabs" role="tablist" aria-label="Inspector">
      <button role="tab" aria-selected={app.inspectorTab === 'table'} class:on={app.inspectorTab === 'table'} onclick={() => (app.inspectorTab = 'table')}>Table</button>
      <button role="tab" aria-selected={app.inspectorTab === 'cell'} class:on={app.inspectorTab === 'cell'} onclick={() => (app.inspectorTab = 'cell')}>Cell</button>
    </div>

    {#if app.inspectorTab === 'table'}
      <label>Name {#key t.id}<input value={t.name} disabled={ro} onchange={(e) => app.renameTable(t.id, value(e))} />{/key}</label>
      {#if t.kind === 'cashflow'}
        <label>Opening balance
          {#key `${t.id}:${t.openingBalance}`}<input value={formatNumber(t.openingBalance)} onchange={setOpening} inputmode="decimal" disabled={ro} />{/key}
        </label>
        <label>As of the start of
          <select value={t.openingMonth} disabled={ro} onchange={(e) => app.updateCashTable(t.id, { openingMonth: value(e) })}>
            {#each monthOptions as m (m)}<option value={m}>{label(m)}</option>{/each}
          </select>
        </label>
        {#if t.openingMonth < app.months[0]}
          <p class="hint">Months before {label(app.months[0])} are hidden, but they still count toward the balance.</p>
        {/if}
        <p class="hint">Enter outflows as negative numbers.</p>
        {#if !ro}<button onclick={() => app.addFooter(t.id)}>+ Footer Formula</button>{/if}
      {:else}
        {#if !ro}
          <button class="primary" onclick={() => pickImportFile(t.id)}>Import CSV / Excel…</button>
          {#if t.importedFrom}
            <p class="hint">Last imported from <b>{t.importedFrom}</b>. Import the new export to refresh; the column mapping is remembered.</p>
          {/if}
        {/if}
        <h3>Conditional Highlighting</h3>
        <HighlightRules table={t} {ro} />
      {/if}
    {:else}
      {#if t.kind === 'cashflow'}
        {#if rowSel}
          {@const row = rowSel.row}
          {@const kind = rowKind(row)}
          <h3>Row: {row.label || 'untitled'}</h3>
          <div class="segmented" role="radiogroup" aria-label="Row type">
            {#each KINDS as k (k.kind)}
              <button role="radio" aria-checked={kind === k.kind} class:on={kind === k.kind} disabled={ro}
                onclick={() => app.setRowKind(t.id, row.id, k.kind)}>{k.label}</button>
            {/each}
          </div>
          {#if kind === 'source' && row.source}
            {@const src = row.source}
            <SourcePicker mode="row" tableId={src.tableId} dateCol={src.dateCol} numberCol={src.amountCol} filters={src.filters} flip={src.flip} disabled={ro}
              onchange={(p) => app.setRowSource(t.id, row.id, { ...(p.tableId !== undefined && { tableId: p.tableId }), ...(p.dateCol !== undefined && { dateCol: p.dateCol }), ...(p.numberCol !== undefined && { amountCol: p.numberCol }), ...(p.filters && { filters: p.filters }), ...(p.flip !== undefined && { flip: p.flip }) })} />
            <p class="hint">Each month totals the amount column for rows dated in that month. Typing in a cell overrides it.</p>
            {#if Object.keys(row.values).length && !ro}
              <button onclick={() => app.clearOverrides(t.id, row.id)}>Remove {Object.keys(row.values).length} override(s)</button>
            {/if}
          {:else if kind === 'formula'}
            {@const err = formulaError((m) => app.ev.row(t, row, m), row.formula ?? '')}
            <label>Formula
              {#key row.id}<input class="mono" value={row.formula} disabled={ro} placeholder="[Sales] * -6%" autocapitalize="off" spellcheck="false"
                onchange={(e) => app.setRowFormula(t.id, row.id, value(e))} />{/key}
            </label>
            {#if row.formula && err}<p class="warn">{err}</p>{/if}
            <p class="hint">Counts toward net cash flow, so it can't use Net cash flow or Balance (use a footer formula).</p>
            {@render formulaHelp()}
          {/if}
        {/if}

        {#if cellSel && rowKind(cellSel.row) !== 'formula'}
          {@const cs = cellSel.table.cellSources[cellSel.key]}
          {@const fromRow = rowKind(cellSel.row) === 'source'}
          {@const mode = cs ? 'total' : fromRow && cellSel.row.values[cellSel.month] === undefined ? 'row' : 'manual'}
          <h3>Cell: {cellSel.row.label || 'untitled'} · {label(cellSel.month)}</h3>
          <div class="segmented" role="radiogroup" aria-label="Cell value">
            {#if fromRow}
              <button role="radio" aria-checked={mode === 'row'} class:on={mode === 'row'} disabled={ro} onclick={() => app.setCellMode(t.id, cellSel.key, 'row')}>From row</button>
            {/if}
            <button role="radio" aria-checked={mode === 'manual'} class:on={mode === 'manual'} disabled={ro} onclick={() => app.setCellMode(t.id, cellSel.key, 'manual')}>Manual</button>
            <button role="radio" aria-checked={mode === 'total'} class:on={mode === 'total'} disabled={ro} onclick={() => app.setCellMode(t.id, cellSel.key, 'total')}>Table total</button>
          </div>
          {#if cs}
            <SourcePicker mode="cell" tableId={cs.tableId} numberCol={cs.col} filters={cs.filters} flip={cs.flip} disabled={ro}
              onchange={(p) => app.updateCellSource(t.id, cellSel.key, { ...(p.tableId !== undefined && { tableId: p.tableId }), ...(p.numberCol !== undefined && { col: p.numberCol }), ...(p.filters && { filters: p.filters }), ...(p.flip !== undefined && { flip: p.flip }) })} />
            <p class="hint">The total of one table column over all matching rows, whatever their dates (⇄).</p>
          {/if}
        {/if}

        {#if footSel}
          {@const f = footSel.footer}
          {@const err = formulaError((m) => app.ev.footer(t, f, m), f.formula)}
          <h3>Footer row</h3>
          <label>Label {#key f.id}<input value={f.label} disabled={ro} onchange={(e) => app.updateFooter(t.id, f.id, { label: value(e).trim() })} />{/key}</label>
          <label>Formula
            {#key f.id}<input class="mono" value={f.formula} disabled={ro} autocapitalize="off" spellcheck="false"
              onchange={(e) => app.updateFooter(t.id, f.id, { formula: value(e) })} />{/key}
          </label>
          {#if err}<p class="warn">{err}</p>{/if}
          <p class="hint">Footer rows don't count toward net cash flow, so they can use [Net cash flow] and [Balance].</p>
          {@render formulaHelp()}
          {#if !ro}<button class="danger" onclick={() => app.deleteFooter(t.id, f.id)}>Delete Footer Row</button>{/if}
        {/if}
      {:else if colSel}
        {@const col = colSel.col}
        <h3>Data Format · {col.name}</h3>
        <select class="wide" aria-label="Data format" value={col.type} disabled={ro} onchange={(e) => app.setColumnType(t.id, col.id, value(e) as ColumnType)}>
          {#each Object.entries(COLUMN_TYPE_LABELS) as [k, v] (k)}<option value={k}>{v}</option>{/each}
        </select>
        <ColumnFormat table={t} {col} {ro} />
      {/if}

      {#if app.canAlign()}
        {@const cur = app.currentAlign()}
        <h3>Text</h3>
        <div class="segmented" role="radiogroup" aria-label="Text alignment">
          {#each [['left', 'Left'], ['center', 'Center'], ['right', 'Right']] as [a, name] (a)}
            <button role="radio" aria-checked={cur === a} class:on={cur === a} disabled={ro} onclick={() => app.applyAlign(a as 'left' | 'center' | 'right')}>{name}</button>
          {/each}
        </div>
      {/if}

      {#if !app.selection}
        <p class="hint">Select cells to see their settings.</p>
      {/if}
    {/if}
  {/if}
</aside>



{#snippet formulaHelp()}
  <details class="help">
    <summary>Formula help</summary>
    <ul>
      <li><code>[Sales] * 6%</code> a row in this table, by label</li>
      <li><code>[Main account].[Balance]</code> a row in another table</li>
      <li><code>PREV([Sales]) * 50%</code> last month's value (<code>PREV(x, 2)</code>: two months back)</li>
      <li><code>SUM([Rent], [Utilities])</code>, <code>MIN</code>, <code>MAX</code>, <code>ABS</code>, <code>ROUND(x, 0)</code>, <code>IF([x] &gt; 0, a, b)</code></li>
      <li>Chinese input is fine: <code>【销售】×（1－10％）</code></li>
    </ul>
  </details>
{/snippet}

<style>
  .inspector {
    width: var(--inspector-w);
    flex-shrink: 0;
    overflow-y: auto;
    background: var(--panel);
    border-left: 1px solid var(--line);
    padding: 12px 14px 80px;
    padding-right: max(14px, env(safe-area-inset-right));
  }
  .inspector.overlay {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    max-width: 100%;
    /* Above content and the status bubble, below the top bar and its popovers. */
    z-index: calc(var(--z-topbar) - 200);
    box-shadow: var(--shadow-menu);
    padding-bottom: calc(24px + env(safe-area-inset-bottom));
    animation: cf-slide-in-end var(--motion-panel) var(--ease-enter);
  }
  .inspector.sheet {
    position: fixed;
    left: 8px;
    right: 8px;
    bottom: calc(8px + env(safe-area-inset-bottom) + var(--kb-inset));
    width: auto;
    max-height: 60vh;
    max-height: 60dvh;
    /* Above content and the status bubble, below the top bar and its popovers. */
    z-index: calc(var(--z-topbar) - 200);
    border: 1px solid var(--line);
    border-radius: var(--radius-12);
    box-shadow: var(--shadow-menu);
    padding-bottom: 24px;
    animation: cf-slide-up var(--motion-panel) var(--ease-enter);
  }
  /* Very short screens: the sheet takes the full height. */
  @media (max-height: 499px) {
    .inspector.sheet {
      top: calc(8px + env(safe-area-inset-top));
      max-height: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .inspector.overlay,
    .inspector.sheet {
      animation-name: cf-fade-in;
    }
  }
  h3 {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
    margin: 18px 0 10px;
    overflow-wrap: anywhere;
  }
  h3:first-child {
    margin-top: 8px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 10px;
    color: var(--muted);
  }
  input:not([type='checkbox']),
  select {
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: var(--radius-6);
    padding: 6px 8px;
    background: var(--panel);
    min-height: var(--field-h);
  }
  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
  }
  /* The panel's title (Sort & Filter) and the Table / Cell tabs. */
  .ptitle {
    font-weight: 600;
    margin: 6px 0 4px;
    display: flex;
    gap: 6px;
    align-items: baseline;
    overflow: hidden;
  }
  .ptitle span {
    color: var(--muted);
    font-weight: 400;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .segmented.tabs {
    margin: 4px 0 14px;
  }
  select.wide {
    width: 100%;
    margin-bottom: 10px;
  }
  .segmented {
    display: flex;
    margin-bottom: 10px;
  }
  .segmented button {
    flex: 1;
    border-radius: 0;
    margin-left: -1px;
  }
  .segmented button:first-child {
    border-radius: 6px 0 0 6px;
    margin-left: 0;
  }
  .segmented button:last-child {
    border-radius: 0 6px 6px 0;
  }
  .segmented button.on {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent);
    position: relative;
  }
  .primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
  }
  .hint {
    color: var(--muted);
    line-height: 1.5;
  }
  .warn {
    color: var(--neg);
    line-height: 1.4;
  }
  .help {
    color: var(--muted);
    margin: 6px 0 12px;
  }
  .help ul {
    padding-left: 16px;
    line-height: 1.6;
  }
  code {
    font-size: 11px;
    background: var(--head);
    padding: 1px 4px;
    border-radius: var(--radius-4);
  }
</style>
