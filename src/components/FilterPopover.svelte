<script lang="ts">
  import { app } from '../lib/store.svelte';
  import { fadeOut } from '../lib/motion';
  import ConditionEditor from './ConditionEditor.svelte';
  import Icon from './Icon.svelte';

  /**
   * Row filter for a Table (Stories: Popover). Opened from a header's filter button (pointer hover)
   * or the toolbar's Filter button (touch and pointer). Rules apply as they change; Undo reverts.
   */
  const ui = $derived(app.filterUI);
  const table = $derived(ui ? app.table(ui.tableId) : undefined);
  const t = $derived(table?.kind === 'table' ? table : undefined);
  const ro = $derived(app.readonly);
  const shown = $derived.by(() => {
    app.version;
    return t ? app.viewItems(t).length : 0;
  });

  let w = $state(0);
  let h = $state(0);
  const place = $derived.by(() => {
    if (!ui || typeof window === 'undefined' || app.sizeClass === 'compact') return '';
    void app.width;
    const left = Math.max(8, Math.min(ui.x - (w || 340), window.innerWidth - (w || 340) - 8));
    const top = Math.max(8, Math.min(ui.y, window.innerHeight - (h || 300) - 8));
    return `left:${left}px;top:${top}px`;
  });

  function close() {
    app.filterUI = null;
  }

  $effect(() => {
    if (!ui) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      e.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // A tap that opens this (e.g. a double-tap) is followed by the browser's click on whatever is now
  // under the finger — the backdrop. Ignore clicks right after opening (Stories: Input model).
  let openedAt = 0;
  $effect(() => {
    if (ui) openedAt = performance.now();
  });
  function backdropClick() {
    if (performance.now() - openedAt > 400) close();
  }
</script>

{#if ui && t}
  <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
  <div class="backdrop" onclick={backdropClick}></div>
  <div class="pop anim-pop" class:sheet-compact={!place} style={place} role="dialog" aria-label="Filter rows" tabindex="-1"
    bind:clientWidth={w} bind:clientHeight={h} out:fadeOut>
    <header>
      <span class="title">Filter “{t.name}”</span>
      <label class="switch">
        <input type="checkbox" checked={t.filter.on} disabled={ro || !t.filter.rules.length}
          onchange={(e) => app.setFilter(t.id, { on: (e.currentTarget as HTMLInputElement).checked })} />
        On
      </label>
    </header>
    {#if t.filter.rules.length > 1}
      <div class="match">
        Show rows that match
        <div class="segmented" role="radiogroup" aria-label="Match">
          <button role="radio" aria-checked={!t.filter.any} class:on={!t.filter.any} disabled={ro} onclick={() => app.setFilter(t.id, { any: false })}>all</button>
          <button role="radio" aria-checked={t.filter.any} class:on={t.filter.any} disabled={ro} onclick={() => app.setFilter(t.id, { any: true })}>any</button>
        </div>
        rules
      </div>
    {/if}
    <ul class="rules">
      {#each t.filter.rules as r (r.id)}
        <li class:focus={ui.colId === r.col}>
          <div class="cond"><ConditionEditor table={t} cond={r} disabled={ro} onchange={(patch) => app.updateFilterRule(t.id, r.id, patch)} /></div>
          {#if !ro}
            <button class="x" aria-label="Remove rule" title="Remove rule" onclick={() => app.removeFilterRule(t.id, r.id)}><Icon name="close" size={14} /></button>
          {/if}
        </li>
      {:else}
        <li class="empty">No rules yet. Add one to show only the rows you want.</li>
      {/each}
    </ul>
    <footer>
      {#if !ro}<button onclick={() => app.addFilterRule(t.id, ui.colId)}>+ Add Rule</button>{/if}
      <span class="count">Showing {shown} of {t.entries.length} rows</span>
    </footer>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-popover) - 100);
  }
  .pop {
    position: fixed;
    z-index: var(--z-popover);
    width: min(var(--popover-w), calc(100vw - 16px));
    max-height: min(70vh, 560px);
    overflow-y: auto;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius-12);
    box-shadow: var(--shadow-menu);
    padding: var(--space-8, 8px) 10px 10px;
    transform-origin: top right;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px;
  }
  .title {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .switch {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: var(--control-h);
  }
  .match {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
    margin-bottom: 6px;
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
  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .count {
    color: var(--muted);
    font-size: 12px;
  }
</style>
