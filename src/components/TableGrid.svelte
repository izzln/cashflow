<script lang="ts">
  import { tick } from 'svelte';
  import { app, ROW_H, ROWTAB_W } from '../lib/store.svelte';
  import { formatNumber } from '../lib/format';
  import { cellsInRanges, columnWidth, dataTableModel, fitColumns, styleKey, textWidth, type ColFit } from '../lib/grid';
  import { cellDisplay } from '../lib/columns';
  import type { Attachment, DataTable } from '../lib/model';
  import { STYLE_BY_ID } from '../lib/styles';
  import Icon from './Icon.svelte';

  let { table }: { table: DataTable } = $props();

  const sel = $derived(app.selection?.tableId === table.id ? app.selection : null);
  const selected = $derived(new Set(sel ? cellsInRanges(sel.ranges).map((p) => `${p.r},${p.c}`) : []));
  const nb = $derived(table.entries.length);
  const totals = $derived.by(() => {
    app.version;
    const m = dataTableModel(table);
    return table.columns.map((_, c) => m.value({ r: nb, c }));
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
        for (const e of table.entries) min = Math.max(min, textWidth(cellDisplay('number', e.cells[col.id])));
        min = Math.max(min, textWidth(String(totals[table.columns.indexOf(col)] ?? '')));
      }
      return { natural: Math.max(natural, min), min, wrap: false };
    });
    return fitColumns(specs, app.fillWidth - 2 - ROWTAB_W);
  });
  const wraps = (c: number) => fitting && (table.columns[c].type === 'text' || table.columns[c].type === 'files');

  function style(rowId: string, colKey: string): string {
    const k = styleKey(rowId, colKey);
    const s = STYLE_BY_ID[table.styles[k]];
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
          {:else}{col.name}{/if}
        </th>
      {/each}
    </tr>
  </thead>
  <tbody>
    {#each table.entries as e, r (e.id)}
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
            class:neg={col.type === 'number' && typeof v === 'number' && v < 0 && !table.styles[styleKey(e.id, col.id)]}
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
            {:else}{cellDisplay(col.type, v)}{/if}
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
        >{typeof v === 'number' ? formatNumber(v) : (v ?? '')}</td>
      {/each}
    </tr>
  </tfoot>
</table>

<style>
  .rename {
    min-height: 0;
    width: 100%;
    font: inherit;
    font-weight: 600;
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
