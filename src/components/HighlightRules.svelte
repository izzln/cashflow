<script lang="ts">
  import { app } from '../lib/store.svelte';
  import { STYLES, STYLE_BY_ID } from '../lib/styles';
  import type { DataTable } from '../lib/model';
  import ReorderList from './ReorderList.svelte';
  import ConditionEditor from './ConditionEditor.svelte';
  import Icon from './Icon.svelte';

  /**
   * Conditional highlighting for a Table: rules in order (drag to reorder; the first that matches a
   * cell wins), each tinting the matching cell or its whole row with a preset tint.
   */
  let { table, ro }: { table: DataTable; ro: boolean } = $props();
  const tints = STYLES.filter((s) => s.id !== 'none');
  const val = (e: Event) => (e.currentTarget as HTMLSelectElement).value;
  const tintStyle = (id: string) => {
    const s = STYLE_BY_ID[id];
    return s ? `background:${s.bg};color:${s.fg}` : '';
  };
</script>

<ReorderList items={table.highlights ?? []} onmove={(a, b) => app.moveHighlight(table.id, a, b)} disabled={ro} label="Drag to reorder: the first matching rule wins">
  {#snippet row(h)}
    <div class="rule">
      <ConditionEditor {table} cond={h.cond} disabled={ro} onchange={(patch) => app.updateHighlight(table.id, h.id, { cond: patch })} />
      <div class="apply">
        <div class="segmented" role="radiogroup" aria-label="Highlight">
          <button role="radio" aria-checked={h.target === 'cell'} class:on={h.target === 'cell'} disabled={ro}
            onclick={() => app.updateHighlight(table.id, h.id, { target: 'cell' })}>Cell</button>
          <button role="radio" aria-checked={h.target === 'row'} class:on={h.target === 'row'} disabled={ro}
            onclick={() => app.updateHighlight(table.id, h.id, { target: 'row' })}>Row</button>
        </div>
        <select aria-label="Tint" value={h.style} disabled={ro} style={tintStyle(h.style)}
          onchange={(e) => app.updateHighlight(table.id, h.id, { style: val(e) })}>
          {#each tints as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
        </select>
        {#if !ro}
          <button class="x" aria-label="Remove rule" title="Remove rule" onclick={() => app.removeHighlight(table.id, h.id)}><Icon name="close" size={14} /></button>
        {/if}
      </div>
    </div>
  {/snippet}
</ReorderList>
{#if !ro}<button onclick={() => app.addHighlight(table.id)}>+ Highlight Rule</button>{/if}
{#if (table.highlights ?? []).length > 1}<p class="hint">The first rule that matches a cell sets its tint; drag ⠿ to reorder.</p>{/if}

<style>
  .rule {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .apply {
    display: flex;
    align-items: center;
    gap: 6px;
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
  select {
    flex: 1;
    min-width: 0;
    border: 1px solid var(--line);
    border-radius: var(--radius-6);
    padding: 4px 8px;
    min-height: var(--field-h);
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
    margin: 6px 0 0;
  }
</style>
