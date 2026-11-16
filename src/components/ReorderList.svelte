<script lang="ts" generics="T extends { id: string }">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  /**
   * A list whose items reorder by dragging their ⠿ handle (mouse or touch), as the sheet tabs do:
   * a 5px threshold, an `accent` drop line, then `onmove(from, to)` with the final index.
   */
  let {
    items,
    onmove,
    row,
    disabled = false,
    label = 'Drag to reorder',
  }: { items: T[]; onmove: (from: number, to: number) => void; row: Snippet<[T, number]>; disabled?: boolean; label?: string } = $props();

  let listEl = $state<HTMLElement | null>(null);
  let drag = $state<{ from: number; y0: number; moved: boolean; to: number; line: number } | null>(null);

  function down(e: PointerEvent, i: number) {
    if (disabled || e.button === 2) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { from: i, y0: e.clientY, moved: false, to: i, line: 0 };
  }

  function move(e: PointerEvent) {
    if (!drag || !listEl) return;
    if (!drag.moved && Math.abs(e.clientY - drag.y0) < 5) return;
    drag.moved = true;
    const lis = [...listEl.querySelectorAll<HTMLElement>(':scope > li')];
    const box = listEl.getBoundingClientRect();
    let to = lis.length;
    for (const [k, li] of lis.entries()) {
      const r = li.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) {
        to = k;
        break;
      }
    }
    drag.to = to;
    const ref = lis[Math.min(to, lis.length - 1)]?.getBoundingClientRect();
    drag.line = ref ? (to < lis.length ? ref.top : ref.bottom) - box.top - 1 : 0;
  }

  function up() {
    const d = drag;
    drag = null;
    if (!d?.moved) return;
    const to = d.to > d.from ? d.to - 1 : d.to;
    if (to !== d.from) onmove(d.from, to);
  }
</script>

<ul class="rlist" bind:this={listEl}>
  {#each items as it, i (it.id)}
    <li class:dragging={drag?.moved && drag.from === i}>
      {#if !disabled}
        <span class="grip" role="button" tabindex="-1" aria-label={label} title={label}
          onpointerdown={(e) => down(e, i)} onpointermove={move} onpointerup={up} onpointercancel={() => (drag = null)}>
          <Icon name="grip" size={16} />
        </span>
      {/if}
      <div class="body">{@render row(it, i)}</div>
    </li>
  {/each}
  {#if drag?.moved}<span class="line" style="top:{drag.line}px"></span>{/if}
</ul>

<style>
  .rlist {
    position: relative;
    list-style: none;
    margin: 0 0 8px;
    padding: 0;
  }
  li {
    display: flex;
    align-items: flex-start;
    gap: 4px;
    padding: 4px 0;
    border-bottom: 1px solid var(--line);
  }
  li:last-of-type {
    border-bottom: none;
  }
  li.dragging {
    opacity: 0.5;
  }
  .grip {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    min-height: var(--control-h);
    color: var(--muted);
    cursor: grab;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
  }
  .body {
    flex: 1;
    min-width: 0;
  }
  .line {
    position: absolute;
    left: 0;
    right: 0;
    height: 3px;
    border-radius: 2px;
    background: var(--accent);
    pointer-events: none;
  }
</style>
