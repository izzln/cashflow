<script lang="ts">
  import { app } from '../lib/store.svelte';
  import type { DataTable } from '../lib/model';
  import ReorderList from './ReorderList.svelte';
  import ConditionEditor from './ConditionEditor.svelte';
  import Icon from './Icon.svelte';

  /**
   * Sort & Filter for the selected Table, in the side panel (like Numbers' Organize sidebar).
   * Sort rules apply as they change (first rule first; drag ⠿ to reorder) and Sort Now re-applies them;
   * filter rules show only the matching rows while the filter is on. Every change is undoable.
   */
  let { table, ro }: { table: DataTable; ro: boolean } = $props();

  const val = (e: Event) => (e.currentTarget as HTMLSelectElement).value;
  const shown = $derived.by(() => {
    app.version;
    return app.viewItems(table).length;
  });
  const sortRules = $derived(table.sort ?? []);
</script>

<h3>Sort</h3>
{#if sortRules.length}
  <ReorderList items={sortRules} onmove={(a, b) => app.moveSortRule(table.id, a, b)} disabled={ro} label="Drag to reorder: the first rule sorts first">
    {#snippet row(r, i)}
      <div class="sortrule">
        <span class="by">{i === 0 ? 'Sort by' : 'then by'}</span>
        <select aria-label="Column" value={r.col} disabled={ro} onchange={(e) => app.updateSortRule(table.id, r.id, { col: val(e) })}>
          {#each table.columns as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
        </select>
        <div class="segmented" role="radiogroup" aria-label="Order">
          <button role="radio" aria-checked={!r.desc} class:on={!r.desc} disabled={ro} title="Ascending" onclick={() => app.updateSortRule(table.id, r.id, { desc: false })}>A→Z</button>
          <button role="radio" aria-checked={r.desc} class:on={r.desc} disabled={ro} title="Descending" onclick={() => app.updateSortRule(table.id, r.id, { desc: true })}>Z→A</button>
        </div>
        {#if !ro}
          <button class="x" aria-label="Remove sort rule" title="Remove rule" onclick={() => app.removeSortRule(table.id, r.id)}><Icon name="close" size={14} /></button>
        {/if}
      </div>
    {/snippet}
  </ReorderList>
{:else}
  <p class="hint">Not sorted. Add a rule to sort the whole table by a column.</p>
{/if}
{#if !ro}
  <div class="buttons">
    <button onclick={() => app.addSortRule(table.id)}>+ Sort Rule</button>
    {#if sortRules.length}<button onclick={() => app.sortNow(table.id)} title="Sort again after editing">Sort Now</button>{/if}
  </div>
{/if}

<h3>Filter</h3>
<div class="filterhead">
  <label class="switch">
    <input type="checkbox" checked={table.filter.on} disabled={ro || !table.filter.rules.length}
      onchange={(e) => app.setFilter(table.id, { on: (e.currentTarget as HTMLInputElement).checked })} />
    Filter on
  </label>
  <span class="count">Showing {shown} of {table.entries.length}</span>
</div>
{#if table.filter.rules.length > 1}
  <div class="match">
    Show rows that match
    <div class="segmented" role="radiogroup" aria-label="Match">
      <button role="radio" aria-checked={!table.filter.any} class:on={!table.filter.any} disabled={ro} onclick={() => app.setFilter(table.id, { any: false })}>all</button>
      <button role="radio" aria-checked={table.filter.any} class:on={table.filter.any} disabled={ro} onclick={() => app.setFilter(table.id, { any: true })}>any</button>
    </div>
  </div>
{/if}
<ul class="rules">
  {#each table.filter.rules as r (r.id)}
    <li class:focus={app.filterFocusCol === r.col}>
      <div class="cond"><ConditionEditor {table} cond={r} disabled={ro} onchange={(patch) => app.updateFilterRule(table.id, r.id, patch)} /></div>
      {#if !ro}
        <button class="x" aria-label="Remove filter rule" title="Remove rule" onclick={() => app.removeFilterRule(table.id, r.id)}><Icon name="close" size={14} /></button>
      {/if}
    </li>
  {:else}
    <li class="empty">No filter rules. Add one to show only the rows you want.</li>
  {/each}
</ul>
{#if !ro}<button onclick={() => app.addFilterRule(table.id)}>+ Filter Rule</button>{/if}

<style>
  .sortrule {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .by {
    color: var(--muted);
    width: 100%;
    font-size: 12px;
  }
  .sortrule select {
    flex: 1 1 100%;
    min-width: 0;
  }
  select {
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: var(--radius-6);
    padding: 4px 8px;
    background: var(--panel);
    min-height: var(--field-h);
  }
  .segmented {
    display: flex;
  }
  .segmented button {
    border-radius: 0;
    margin-left: -1px;
    padding: 2px 10px;
  }
  .segmented button:first-child {
    border-radius: var(--radius-6) 0 0 var(--radius-6);
    margin-left: 0;
  }
  .segmented button:last-child {
    border-radius: 0 var(--radius-6) var(--radius-6) 0;
  }
  .segmented button.on {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent);
    position: relative;
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .filterhead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px;
  }
  .switch {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: var(--control-h);
  }
  .count {
    color: var(--muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .match {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
    margin-bottom: 6px;
  }
  .rules {
    list-style: none;
    margin: 0 0 8px;
    padding: 0;
  }
  .rules li {
    display: flex;
    align-items: flex-start;
    gap: 4px;
    padding: 6px 0;
    border-top: 1px solid var(--line);
  }
  .rules li.focus .cond {
    outline: 2px solid var(--accent-soft);
    border-radius: var(--radius-6);
  }
  .cond {
    flex: 1;
    min-width: 0;
  }
  .empty {
    color: var(--muted);
    line-height: 1.5;
  }
  .x {
    border: none;
    background: none;
    color: var(--muted);
    min-width: var(--touch-target);
    min-height: var(--control-h);
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .hint {
    color: var(--muted);
    line-height: 1.5;
  }
  h3 {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
    margin: 18px 0 10px;
  }
  h3:first-child {
    margin-top: 8px;
  }
</style>
