<script lang="ts">
  import { app } from '../lib/store.svelte';
  import { fadeOut } from '../lib/motion';

  /**
   * The choices of a Pop-Up Menu cell, as a menu under the cell (Stories: ContextMenu rows). A tap or
   * click picks one; Blank clears the cell; Esc or a tap elsewhere closes it.
   */
  const target = $derived(app.optionsCell);
  const table = $derived(target ? app.table(target.tableId) : undefined);
  const col = $derived(table?.kind === 'table' ? table.columns.find((c) => c.id === target?.colId) : undefined);
  const current = $derived.by(() => {
    if (table?.kind !== 'table' || !target) return undefined;
    return table.entries.find((e) => e.id === target.rowId)?.cells[target.colId];
  });

  let w = $state(0);
  let h = $state(0);
  const place = $derived.by(() => {
    if (!target || !table || typeof window === 'undefined') return '';
    void app.width;
    const r = app.viewItems(table).findIndex((e) => e.id === target.rowId);
    const c = table.kind === 'table' ? table.columns.findIndex((x) => x.id === target.colId) : -1;
    const el = document.querySelector<HTMLElement>(`td[data-t="${target.tableId}"][data-r="${r}"][data-c="${c}"]`);
    if (!el || app.sizeClass === 'compact') return '';
    const b = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(b.left, window.innerWidth - (w || 220) - 8));
    const top = b.bottom + (h || 200) + 8 > window.innerHeight ? Math.max(8, b.top - (h || 200) - 4) : b.bottom + 4;
    return `left:${left}px;top:${top}px`;
  });

  function close() {
    app.optionsCell = null;
  }

  function pick(label: string | null) {
    if (target) app.setChoice(target.tableId, target.rowId, target.colId, label);
    close();
  }

  $effect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
</script>

{#if target && col}
  <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
  <div class="backdrop" onclick={close}></div>
  <ul class="menu anim-pop from-left" class:sheet-compact={!place} style={place} role="menu" aria-label={col.name}
    bind:clientWidth={w} bind:clientHeight={h} out:fadeOut>
    <li role="none">
      <button role="menuitemradio" aria-checked={current === undefined} onclick={() => pick(null)}>
        <span class="check">{current === undefined ? '✓' : ''}</span><span class="label blank">Blank</span>
      </button>
    </li>
    {#if col.options?.length}<li class="sep" role="separator"></li>{/if}
    {#each col.options ?? [] as o (o.id)}
      <li role="none">
        <button role="menuitemradio" aria-checked={current === o.label} onclick={() => pick(o.label)}>
          <span class="check">{current === o.label ? '✓' : ''}</span><span class="label">{o.label}</span>
        </button>
      </li>
    {/each}
    {#if !col.options?.length}<li class="hint">No choices yet. Add them in the Inspector.</li>{/if}
  </ul>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-popup) - 50);
  }
  .menu {
    position: fixed;
    z-index: var(--z-popup);
    list-style: none;
    margin: 0;
    padding: 5px;
    min-width: max(var(--menu-min-w), 160px);
    max-height: min(60vh, 420px);
    overflow-y: auto;
    background: var(--menu-bg);
    border: 1px solid var(--line);
    border-radius: var(--radius-10);
    box-shadow: var(--shadow-menu);
    -webkit-backdrop-filter: blur(20px);
    backdrop-filter: blur(20px);
  }
  button {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    border: none;
    background: none;
    border-radius: var(--radius-5);
    padding: 4px 8px;
    min-height: var(--row-h);
    text-align: left;
    cursor: default;
  }
  @media (pointer: coarse) {
    button {
      min-height: var(--touch-target);
    }
  }
  button:hover,
  button:active {
    background: var(--accent);
    color: var(--on-accent);
  }
  .check {
    width: 14px;
    flex-shrink: 0;
  }
  .label {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .blank {
    color: var(--muted);
  }
  button:hover .blank,
  button:active .blank {
    color: var(--on-accent-muted);
  }
  .sep {
    height: 1px;
    background: var(--line);
    margin: 4px 6px;
  }
  .hint {
    color: var(--muted);
    padding: 6px 8px;
  }
</style>
