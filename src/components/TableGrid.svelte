<script lang="ts">
  import { tick } from 'svelte';
  import { app, ROW_H, ROWTAB_W } from '../lib/store.svelte';
  import { cellsInRanges, columnWidth, fitColumns, isFiltered, styleKey, textWidth, type ColFit } from '../lib/grid';
  import { cellDisplay, formatWith, matchCond } from '../lib/columns';
  import type { Attachment, DataTable, Entry } from '../lib/model';
  import { STYLE_BY_ID } from '../lib/styles';
  import Icon from './Icon.svelte';

  let { table }: { table: DataTable } = $props();

  const sel = $derived(app.selection?.tableId === table.id ? app.selection : null);
  const selected = $derived(new Set(sel ? cellsInRanges(sel.ranges).map((p) => `${p.r},${p.c}`) : []));
  // The rows shown: all, or those passing the row filter (row r is rows[r]).
  const rows = $derived.by(() => {
    app.version;
    return app.viewItems(table) as Entry[];
  });
  const nb = $derived(rows.length);
  const totals = $derived.by(() => {
    app.version;
    const m = app.model(table);
    return table.columns.map((_, c) => m.value({ r: m.body, c }));
  });
  const filtered = $derived(isFiltered(table));
  /** Columns that have a filter rule (their header shows the filter button). */
  const filterCols = $derived(new Set(filtered ? table.filter.rules.map((r) => r.col) : []));

  /**
   * Conditional highlighting: the tint for each cell of a row. Rules are tried in order and the first
   * that matches a cell wins; a row rule tints every cell, a cell rule the cell in its column.
   */
  function highlightsFor(e: Entry): Record<string, string> {
    const out: Record<string, string> = {};
    for (const h of table.highlights ?? []) {
      if (!matchCond(e, table.columns, h.cond)) continue;
      const cols = h.target === 'row' ? table.columns.map((c) => c.id) : [h.cond.col];
      for (const id of cols) out[id] ??= h.style;
    }
    return out;
  }
  const hl = $derived.by(() => {
    app.version;
    return new Map(rows.map((e) => [e.id, highlightsFor(e)]));
  });

  // Fill Window fits the columns to the available width (see fitColumns).
  const fitting = $derived(app.maximizedId === table.id && app.fillWidth > 0);
  const widths = $derived.by(() => {
    app.version;
    if (!fitting) return table.columns.map(columnWidth);
    const specs: ColFit[] = table.columns.map((col) => {
      const natural = columnWidth(col);
      if (col.type === 'text') return { natural, min: 80, wrap: true };
      if (col.type === 'files') return { natural, min: 110, wrap: true };
      let min = Math.max(56, textWidth(col.name));
      if (col.type === 'date') min = Math.max(min, textWidth('2026-11-07'));
      if (col.type === 'number') {
        for (const e of rows) min = Math.max(min, textWidth(cellDisplay(col, e.cells[col.id])));
        min = Math.max(min, textWidth(String(totals[table.columns.indexOf(col)] ?? '')));
      }
      return { natural: Math.max(natural, min), min, wrap: false };
    });
    return fitColumns(specs, app.fillWidth - 2 - ROWTAB_W);
  });
  const wraps = (c: number) => fitting && (table.columns[c].type === 'text' || table.columns[c].type === 'files');

  /** A cell's tint (conditional highlighting first, then its own) and alignment. */
  function style(rowId: string, colKey: string): string {
    const k = styleKey(rowId, colKey);
    const s = STYLE_BY_ID[hl.get(rowId)?.[colKey] ?? table.styles[k]];
    const a = table.aligns[k];
    return `${s ? `background:${s.bg};color:${s.fg};` : ''}${a ? `text-align:${a};` : ''}`;
  }
  const anchor = (r: number, c: number) => !!sel && sel.anchor.r === r && sel.anchor.c === c;

  // ----- renaming a column in place (double-click its header) -----
  let renaming = $state<string | null>(null);
  let draft = $state('');
  let inputEl = $state<HTMLInputElement | null>(null);

  // Renaming is started from the header (double-click), the menus or the panel, via app.renamingColumn.
  $effect(() => {
    const r = app.renamingColumn;
    if (r && r.tableId === table.id && !app.readonly) {
      renaming = r.colId;
      draft = table.columns.find((c) => c.id === r.colId)?.name ?? '';
      tick().then(() => {
        inputEl?.focus();
        inputEl?.select();
      });
    }
  });

  function renameColumn(colId: string) {
    if (!app.readonly) app.renamingColumn = { tableId: table.id, colId };
  }

  function finish(save: boolean) {
    if (save && renaming) app.renameColumn(table.id, renaming, draft);
    renaming = null;
    app.renamingColumn = null;
  }

  // Fully selected rows and columns light up their row tab / header cell (TableFrame handles the input).
  const onRows = $derived(new Set(sel ? app.wholeLines(table.id, 'row') : []));
  const onCols = $derived(new Set(sel ? app.wholeLines(table.id, 'col') : []));

  const files = (v: unknown) => (Array.isArray(v) ? (v as Attachment[]) : []);
  let dropKey = $state<string | null>(null);
</script>

<!-- An explicit width keeps table-layout: fixed in force, so columns keep their widths (and scroll) when they don't fit. -->
<table style="width:{ROWTAB_W + widths.reduce((a, b) => a + b, 0)}px">
  <colgroup>
    <col style="width:{ROWTAB_W}px" />
    {#each table.columns as col, c (col.id)}<col style="width:{widths[c]}px" />{/each}
  </colgroup>
  <thead>
    <tr style="height:{ROW_H}px">
      <th class="rowtab corner" data-t={table.id} data-tabcorner title="Select the whole table"></th>
      {#each table.columns as col, c (col.id)}
        <!-- The header row is the column tab: click selects the column, drag moves it, double-click renames. -->
        <th
          data-t={table.id}
          data-h={c}
          data-coltab={c}
          class="center coltab"
          class:on={onCols.has(c)}
          class:wrap={wraps(c)}
          title={app.readonly ? col.name : `${col.name} — click to select, drag to move, double-click to rename`}
          ondblclick={() => renameColumn(col.id)}
        >
          {#if renaming === col.id}
            <input
              class="rename"
              bind:this={inputEl}
              bind:value={draft}
              onblur={() => finish(true)}
              onpointerdown={(e) => e.stopPropagation()}
              onkeydown={(e) => {
                if (e.isComposing || e.keyCode === 229) return;
                if (e.key === 'Enter') finish(true);
                if (e.key === 'Escape') finish(false);
              }}
            />
          {:else}
            {col.name}
            {#if !app.readonly}
              <!-- Filter: shown on hover (pointer) and always while the column is filtered; touch uses the toolbar. -->
              <button class="filterbtn" class:active={filterCols.has(col.id)} data-filter={col.id} tabindex="-1"
                title={filterCols.has(col.id) ? 'Filtered — change the filter' : 'Filter rows by this column'}
                aria-label={`Filter by ${col.name}`}><Icon name="filter" size={14} /></button>
            {/if}
          {/if}
        </th>
      {/each}
    </tr>
  </thead>
  <tbody>
    {#each rows as e, r (e.id)}
      <tr style="height:{ROW_H}px">
        <th class="rowtab" class:on={onRows.has(r)} data-t={table.id} data-rowtab={r} aria-label={`Row ${r + 1}`}>{r + 1}</th>
        {#each table.columns as col, c (col.id)}
          {@const v = e.cells[col.id]}
          <td
            data-t={table.id}
            data-r={r}
            data-c={c}
            class:right={col.type === 'number'}
            class:center={col.type === 'checkbox'}
            class:header-col={c === 0}
            class:wrap={wraps(c)}
            class:neg={col.type === 'number' && typeof v === 'number' && v < 0 && !table.styles[styleKey(e.id, col.id)] && !hl.get(e.id)?.[col.id]}
            class:numbered={col.type === 'numbering'}
            class:popup={col.type === 'select'}
            class:sel={selected.has(`${r},${c}`)}
            class:anchor={anchor(r, c)}
            data-files={col.type === 'files' ? '' : undefined}
            class:drop={dropKey === `${e.id}|${col.id}`}
            style={style(e.id, col.id)}
            ondragover={(ev) => {
              if (col.type !== 'files' || app.readonly || !ev.dataTransfer?.types.includes('Files')) return;
              ev.preventDefault();
              dropKey = `${e.id}|${col.id}`;
            }}
            ondragleave={() => (dropKey = null)}
            ondrop={(ev) => {
              if (col.type !== 'files' || app.readonly) return;
              ev.preventDefault();
              dropKey = null;
              const list = ev.dataTransfer?.files ? [...ev.dataTransfer.files] : [];
              app.select(table.id, { r, c });
              app.attachFiles(table.id, e.id, col.id, list);
            }}
          >
            {#if col.type === 'checkbox'}
              <span class="check" class:on={v === true} data-check role="checkbox" aria-checked={v === true} aria-label={col.name}>{v === true ? '✓' : ''}</span>
            {:else if col.type === 'files'}
              {#each files(v) as f (f.id)}<span class="chip" title={f.name}><Icon name="clip" size={12} /> {f.name}</span>{/each}
            {:else if col.type === 'select'}
              {#if v !== undefined}<span class="pick">{v}</span>{/if}
              {#if !app.readonly}
                <!-- Opens the choices with one click or tap; shown on the selected cell (and on hover). -->
                <span class="pickbtn" class:shown={anchor(r, c)} data-pick role="button" tabindex="-1" aria-label={`Choose ${col.name}`} title="Choose"><Icon name="chevron" size={14} /></span>
              {/if}
            {:else}{cellDisplay(col, v)}{/if}
          </td>
        {/each}
      </tr>
    {/each}
  </tbody>
  <tfoot>
    <tr style="height:{ROW_H}px" class="first">
      <th class="rowtab" class:on={onRows.has(nb)} data-t={table.id} data-rowtab={nb} aria-label="Total row"></th>
      {#each table.columns as col, c (col.id)}
        {@const v = totals[c]}
        <td
          data-t={table.id}
          data-r={nb}
          data-c={c}
          class:right={col.type === 'number'}
          class:center={col.type === 'checkbox'}
          class:neg={typeof v === 'number' && v < 0}
          class:sel={selected.has(`${nb},${c}`)}
          class:anchor={anchor(nb, c)}
          style={style('__total', col.id)}
        >{typeof v === 'number' ? formatWith(v, col) : (v ?? '')}</td>
      {/each}
    </tr>
  </tfoot>
</table>

<style>
  /* Filter button in a header cell: hover reveals it on pointer devices; an active filter keeps it shown. */
  .filterbtn {
    position: absolute;
    right: 2px;
    top: 50%;
    transform: translateY(-50%);
    display: none;
    align-items: center;
    justify-content: center;
    min-height: 0;
    width: 22px;
    height: 22px;
    padding: 0;
    border: none;
    border-radius: var(--radius-4);
    background: var(--panel);
    color: var(--muted);
  }
  :global(th.coltab) {
    position: relative;
  }
  @media (hover: hover) {
    :global(th.coltab:hover) .filterbtn {
      display: inline-flex;
    }
  }
  .filterbtn.active {
    display: inline-flex;
    color: var(--accent);
  }
  .pick {
    display: inline-block;
    max-width: calc(100% - 14px);
    overflow: hidden;
    text-overflow: ellipsis;
    vertical-align: middle;
    background: var(--head);
    border-radius: var(--radius-10);
    padding: 0 8px;
    line-height: 20px;
  }
  /* Pop-Up Menu cells: room on the right for the menu button. */
  td.popup {
    padding-right: 30px;
  }
  .pickbtn {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 28px;
    display: none;
    align-items: center;
    justify-content: center;
    color: var(--muted);
    border-left: 1px solid var(--line);
    background: transparent;
    cursor: pointer;
    touch-action: none;
  }
  .pickbtn.shown {
    display: flex;
  }
  @media (hover: hover) {
    td.popup:hover .pickbtn {
      display: flex;
    }
    .pickbtn:hover {
      background: var(--accent-soft);
      color: var(--accent);
    }
  }
  @media (pointer: coarse) {
    td.popup {
      padding-right: 38px;
    }
    .pickbtn {
      width: var(--touch-target);
    }
  }
  td.numbered {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  /* Its own colours: the header around it is accent-filled while the column is selected. */
  .rename {
    min-height: 0;
    width: 100%;
    font: inherit;
    font-weight: 600;
    color: var(--text);
    background: var(--panel);
    /* Header text is always centred, while renaming too. */
    text-align: center;
    border: 1px solid var(--accent);
    border-radius: var(--radius-4);
    padding: 1px 4px;
  }
  .check {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border: 1.5px solid var(--line-strong);
    border-radius: var(--radius-4);
    background: var(--panel);
    color: var(--on-accent);
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    vertical-align: middle;
  }
  .check.on {
    background: var(--accent);
    border-color: var(--accent);
  }
  td.drop {
    outline: 2px dashed var(--accent);
    outline-offset: -3px;
  }
  .chip {
    display: inline-block;
    max-width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
    vertical-align: middle;
    background: var(--head);
    border-radius: var(--radius-10);
    padding: 0 7px;
    margin-right: 4px;
    font-size: 12px;
    line-height: 20px;
  }
</style>
