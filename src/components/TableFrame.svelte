<script lang="ts">
  import { onMount, tick, type Snippet } from 'svelte';
  import { zoomFrom } from '../lib/motion';
  import { app, ROWTAB_W } from '../lib/store.svelte';
  import { cellsInRanges, isFiltered, type Pos } from '../lib/grid';
  import Icon from './Icon.svelte';
  import type { Table } from '../lib/model';

  let { table, children, maximized = false }: { table: Table; children: Snippet; maximized?: boolean } = $props();
  let frameEl = $state<HTMLElement | null>(null);
  let bodyWidth = $state(0);
  let bodyEl = $state<HTMLElement | null>(null);
  let cardEl = $state<HTMLElement | null>(null);
  // Fill Window / Restore: zoom from where the table was (Stories: Motion).
  onMount(() => {
    const from = app.fillFrom;
    if (!from || from.id !== table.id || !cardEl) return;
    app.fillFrom = null;
    zoomFrom(cardEl, from.rect, maximized ? 1 : app.zoom);
  });
  $effect(() => {
    if (maximized) app.fillWidth = bodyWidth;
  });

  const sel = $derived(app.selection?.tableId === table.id ? app.selection : null);
  const selected = $derived(new Set(sel ? cellsInRanges(sel.ranges).map((p) => `${p.r},${p.c}`) : []));


  // ----- pointer handling -----
  // Mouse: press and drag selects a range; Shift extends; ⌘/Ctrl adds a range.
  // Touch (as in Numbers): a tap selects (a drag on an unselected cell scrolls the canvas);
  //        a tap on the selection shows or hides the edit menu; a double-tap edits;
  //        a drag from a selected cell extends the selection.

  let dragging = false;
  let pendingTap: Pos | null = null;
  let moved = false;
  /** The last tap that selected or toggled a menu: a second tap on that cell soon after edits. */
  let lastTap: { p: Pos; at: number } | null = null;
  /** The menu was open when this touch began (the press closed it): the tap only hides it. */
  let menuWasOpen = false;
  const DOUBLE_TAP_MS = 350;

  function isDoubleTap(p: Pos, at: number): boolean {
    return !!lastTap && lastTap.p.r === p.r && lastTap.p.c === p.c && at - lastTap.at < DOUBLE_TAP_MS;
  }
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let pressed = false;

  /** Viewport point at the top centre of a cell: where the touch edit menu appears. */
  function cellPoint(p: Pos): { x: number; y: number } {
    const el = document.querySelector<HTMLElement>(`[data-t="${table.id}"][data-r="${p.r}"][data-c="${p.c}"]`);
    const r = el?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.top } : { x: 100, y: 100 };
  }

  function openMenu(kind: 'context' | 'edit', target: 'cells' | 'table' | 'column' | 'rows' | 'columns', x: number, y: number) {
    app.menu = { kind, target, tableId: table.id, x, y };
  }

  /** Long-press on touch = right-click: select (if needed) and open the context menu. */
  function startPress(e: PointerEvent, p: Pos) {
    cancelPress();
    pressed = false;
    const { clientX, clientY } = e;
    pressTimer = setTimeout(() => {
      pressed = true;
      pendingTap = null;
      if (!selected.has(`${p.r},${p.c}`)) app.select(table.id, p);
      openMenu('context', 'cells', clientX, clientY);
    }, 550);
  }

  function cancelPress() {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = null;
  }

  function posOf(el: Element | null): Pos | null {
    const cell = el?.closest<HTMLElement>('[data-r]');
    if (!cell || cell.dataset.t !== table.id) return null;
    return { r: Number(cell.dataset.r), c: Number(cell.dataset.c) };
  }

  // ----- row tabs and the header row (the column tabs) -----
  // Click/tap selects the row or column (Shift extends); drag reorders; drag a row off the table
  // onto the canvas makes a new table (⌥ copies). Touch: a tap on a selected line shows its edit
  // menu, long-press opens the context menu, double-tap a column header renames it.

  type Hit = { kind: 'corner' } | { kind: 'years'; c0: number; c1: number } | { kind: 'line'; axis: 'row' | 'col'; i: number; el: HTMLElement };

  function hitOf(el: Element | null): Hit | null {
    const th = el?.closest<HTMLElement>('[data-rowtab], [data-coltab], [data-years], [data-tabcorner]');
    if (!th || th.dataset.t !== table.id || th.querySelector('input')) return null;
    if (th.dataset.tabcorner !== undefined) return { kind: 'corner' };
    if (th.dataset.years) {
      const [c0, c1] = th.dataset.years.split('-').map(Number);
      return { kind: 'years', c0, c1 };
    }
    if (th.dataset.rowtab !== undefined) return { kind: 'line', axis: 'row', i: Number(th.dataset.rowtab), el: th };
    return { kind: 'line', axis: 'col', i: Number(th.dataset.coltab), el: th };
  }

  const bodyRows = () => (table.kind === 'table' ? table.entries.length : table.rows.length);
  const scale = () => (maximized ? 1 : app.zoom);

  let line = $state<{
    axis: 'row' | 'col';
    lines: number[];
    x0: number;
    y0: number;
    moved: boolean;
    outside: boolean;
    to: number;
    /** Drop line, in the card's unscaled pixels. */
    marker: { x: number; y: number; w: number; h: number } | null;
    pointer: string;
    showMenu: boolean;
    el: HTMLElement;
    i: number;
  } | null>(null);
  let linePress: ReturnType<typeof setTimeout> | null = null;
  let linePressed = false;
  let lastHeaderTap: { c: number; at: number } | null = null;

  /** Rectangles (screen pixels) of the lines a drag can drop between. */
  function targets(axis: 'row' | 'col'): DOMRect[] {
    if (axis === 'row') {
      const n = bodyRows();
      return [...(frameEl?.querySelectorAll<HTMLElement>('tbody [data-rowtab]') ?? [])].slice(0, n).map((el) => el.getBoundingClientRect());
    }
    return [...(frameEl?.querySelectorAll<HTMLElement>('thead [data-coltab]') ?? [])].map((el) => el.getBoundingClientRect());
  }

  /** In Fill Window: the visible part of the body, below the pinned header rows and right of the pinned columns. */
  function visibleBox() {
    const b = bodyEl!.getBoundingClientRect();
    const heads = [...(bodyEl!.querySelectorAll<HTMLElement>('thead th'))].map((th) => th.getBoundingClientRect().bottom);
    const first = bodyEl!.querySelector<HTMLElement>('tbody td[data-c="0"]')?.getBoundingClientRect();
    const tabs = b.left + ROWTAB_W;
    return {
      top: Math.max(b.top, ...heads),
      bottom: b.top + bodyEl!.clientHeight,
      /** Right of the pinned first column: columns scroll in from here. */
      left: Math.max(tabs, first?.right ?? tabs),
      /** Right of the row tabs: the pinned first column is still a drop target. */
      tabs,
      right: b.left + bodyEl!.clientWidth,
    };
  }

  function onLineDown(e: PointerEvent): boolean {
    const hit = hitOf(e.target as Element);
    if (!hit) return false;
    if (e.button === 2) return true; // right-click: the contextmenu event handles it
    e.preventDefault();
    app.commitEdit();
    const closedMenu = app.menuClosedAt === e.timeStamp;
    app.menu = null;
    if (hit.kind === 'corner') {
      app.select(table.id, { r: 0, c: 0 });
      app.selectAll();
      return true;
    }
    if (hit.kind === 'years') {
      app.selectLines(table.id, 'col', hit.c0, hit.c1);
      return true;
    }
    const { axis, i } = hit;
    const showMenu = app.wholeLines(table.id, axis).includes(i) && !e.shiftKey && !closedMenu;
    if (!app.wholeLines(table.id, axis).includes(i) || e.shiftKey) app.selectLines(table.id, axis, i, i, e.shiftKey);
    const lines = app.wholeLines(table.id, axis);
    const draggable = !app.readonly && (axis === 'row' ? lines.every((r) => r < bodyRows()) : table.kind === 'table');
    line = {
      axis, lines: draggable ? lines : [], x0: e.clientX, y0: e.clientY, moved: false, outside: false, to: -1, marker: null,
      pointer: e.pointerType, showMenu, el: hit.el, i,
    };
    linePressed = false;
    if (e.pointerType === 'touch') {
      const { clientX, clientY } = e;
      linePress = setTimeout(() => {
        if (!line || line.moved) return;
        linePressed = true;
        openMenu('context', axis === 'row' ? 'rows' : 'columns', clientX, clientY);
      }, 550);
    }
    window.addEventListener('pointermove', onLineMove);
    window.addEventListener('pointerup', onLineUp, { once: true });
    window.addEventListener('pointercancel', onLineCancel, { once: true });
    return true;
  }

  function onLineMove(e: PointerEvent) {
    const d = line;
    if (!d || !d.lines.length || !cardEl) return;
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 5) return;
    d.moved = true;
    if (linePress) clearTimeout(linePress);
    const t = cardEl.getBoundingClientRect();
    const m = 28;
    d.outside = !maximized && (e.clientX < t.left - m || e.clientX > t.right + m || e.clientY < t.top - m || e.clientY > t.bottom + m);
    if (d.outside) {
      d.marker = null;
      const n = d.lines.length;
      app.lineGhost = {
        x: e.clientX,
        y: e.clientY,
        text: `New ${table.kind === 'table' ? 'table' : 'cashflow'} with ${n} ${d.axis === 'row' ? 'row' : 'column'}${n === 1 ? '' : 's'}`,
      };
      return;
    }
    app.lineGhost = null;
    if (maximized) autoScroll(e.clientX, e.clientY);
    place(e.clientX, e.clientY);
  }

  /** Where a drag at (x, y) would drop, and the drop line for it. */
  function place(x: number, y: number) {
    const d = line;
    if (!d || !cardEl) return;
    if (maximized && bodyEl) {
      const v = visibleBox();
      x = Math.min(Math.max(x, v.tabs), v.right);
      y = Math.min(Math.max(y, v.top), v.bottom);
    }
    const rects = targets(d.axis);
    if (!rects.length) return;
    const card = cardEl.getBoundingClientRect();
    const z = scale();
    const grid = (frameEl?.querySelector('table') ?? cardEl).getBoundingClientRect();
    let to = rects.length;
    if (d.axis === 'row') {
      for (const [k, r] of rects.entries()) if (y < r.top + r.height / 2) { to = k; break; }
      const at = to < rects.length ? rects[to].top : rects[rects.length - 1].bottom;
      d.marker = { x: (grid.left - card.left) / z, y: (at - card.top) / z - 1, w: Math.min(grid.width, card.width) / z, h: 3 };
    } else {
      for (const [k, r] of rects.entries()) if (x < r.left + r.width / 2) { to = k; break; }
      const at = to < rects.length ? rects[to].left : rects[rects.length - 1].right;
      d.marker = { x: (at - card.left) / z - 1, y: (grid.top - card.top) / z, w: 3, h: Math.min(grid.height, card.height) / z };
    }
    d.to = to;
  }

  // Fill Window: holding a drag near the body's edge scrolls it.
  let scrollRaf = 0;
  function autoScroll(x: number, y: number) {
    cancelAnimationFrame(scrollRaf);
    const d = line;
    if (!d || !bodyEl) return;
    const v = visibleBox();
    const edge = 28;
    const dy = d.axis === 'row' ? (y < v.top + edge ? -1 : y > v.bottom - edge ? 1 : 0) : 0;
    const dx = d.axis === 'col' ? (x < v.left + edge ? -1 : x > v.right - edge ? 1 : 0) : 0;
    if (!dx && !dy) return;
    const step = () => {
      if (!line || !bodyEl) return;
      bodyEl.scrollBy(dx * 14, dy * 14);
      place(x, y);
      scrollRaf = requestAnimationFrame(step);
    };
    scrollRaf = requestAnimationFrame(step);
  }

  function endLine() {
    window.removeEventListener('pointermove', onLineMove);
    window.removeEventListener('pointercancel', onLineCancel);
    cancelAnimationFrame(scrollRaf);
    if (linePress) clearTimeout(linePress);
    linePress = null;
    app.lineGhost = null;
    const d = line;
    line = null;
    return d;
  }

  function onLineCancel() {
    window.removeEventListener('pointerup', onLineUp);
    endLine();
  }

  function onLineUp(e: PointerEvent) {
    const d = endLine();
    if (!d || linePressed) return;
    if (!d.moved) {
      if (d.pointer !== 'touch') return;
      // Touch, as in Numbers: double-tap a column header to rename it; a tap on a selected line shows its menu.
      if (d.axis === 'col' && table.kind === 'table' && !app.readonly && lastHeaderTap?.c === d.i && e.timeStamp - lastHeaderTap.at < 350) {
        lastHeaderTap = null;
        app.renamingColumn = { tableId: table.id, colId: table.columns[d.i].id };
        return;
      }
      lastHeaderTap = d.axis === 'col' ? { c: d.i, at: e.timeStamp } : null;
      if (d.showMenu) {
        const r = d.el.getBoundingClientRect();
        openMenu('edit', d.axis === 'row' ? 'rows' : 'columns', r.left + Math.min(r.width, 200) / 2, r.top);
      }
      return;
    }
    if (d.outside) {
      // Drop point in unzoomed canvas pixels.
      const content = app.contentEl?.getBoundingClientRect();
      const x = (e.clientX - (content?.left ?? 0)) / app.zoom - 20;
      const y = (e.clientY - (content?.top ?? 0)) / app.zoom - 20;
      if (d.axis === 'row') app.extractRows(table.id, d.lines, x, y, e.altKey);
      else app.extractColumns(table.id, d.lines, x, y, e.altKey);
    } else if (d.to >= 0) {
      if (d.axis === 'row') app.moveRows(table.id, d.lines, d.to);
      else app.moveColumns(table.id, d.lines, d.to);
    }
  }

  // ----- resizing a Table column by its header's right edge -----
  let resizing: { colId: string; x0: number; w0: number; moved: boolean } | null = null;

  function onResizeDown(e: PointerEvent): boolean {
    const h = (e.target as Element).closest<HTMLElement>('[data-colresize]');
    if (!h || table.kind !== 'table' || e.button === 2) return false;
    e.preventDefault();
    e.stopPropagation();
    app.commitEdit();
    const col = table.columns[Number(h.dataset.colresize)];
    const th = h.closest('th');
    if (!col || !th) return true;
    resizing = { colId: col.id, x0: e.clientX, w0: th.getBoundingClientRect().width / scale(), moved: false };
    window.addEventListener('pointermove', onResizeMove);
    window.addEventListener('pointerup', onResizeUp, { once: true });
    return true;
  }

  function onResizeMove(e: PointerEvent) {
    const r = resizing;
    if (!r) return;
    if (!r.moved) {
      if (Math.abs(e.clientX - r.x0) < 3) return;
      r.moved = true;
      app.checkpoint();
    }
    app.resizeColumn(table.id, r.colId, r.w0 + (e.clientX - r.x0) / scale());
  }

  function onResizeUp() {
    window.removeEventListener('pointermove', onResizeMove);
    if (resizing?.moved) app.save();
    resizing = null;
  }

  function onCellDown(e: PointerEvent) {
    // A header's filter button opens the row filter on that column.
    const fb = (e.target as Element).closest<HTMLElement>('[data-filter]');
    if (fb) {
      e.preventDefault();
      e.stopPropagation();
      app.commitEdit();
      app.openFilter(table.id, fb.dataset.filter);
      return;
    }
    if (onResizeDown(e)) return;
    if (onLineDown(e)) return;
    // A Pop-Up Menu cell's button opens its choices at once.
    if ((e.target as Element).closest('[data-pick]')) {
      const pp = posOf(e.target as Element);
      if (pp && e.button !== 2) {
        e.preventDefault();
        e.stopPropagation();
        app.commitEdit();
        app.menu = null;
        app.select(table.id, pp);
        app.startEdit();
        return;
      }
    }
    const p = posOf(e.target as Element);
    if (!p) return;
    if (app.editing) app.commitEdit();
    moved = false;
    if (e.pointerType === 'touch') {
      menuWasOpen = app.menuClosedAt === e.timeStamp;
      startPress(e, p);
      if (!selected.has(`${p.r},${p.c}`)) {
        pendingTap = p;
        return;
      }
      pendingTap = null;
      tapped = p;
      dragging = true;
    } else {
      if (e.button === 2) return; // right-click: handled by the contextmenu event
      // preventDefault stops text selection but also keeps focus where it was;
      // release a panel field so typing reaches the grid.
      e.preventDefault();
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== app.editorEl && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(active.tagName)) active.blur();
      const mode = e.shiftKey ? 'extend' : e.metaKey || e.ctrlKey ? 'add' : 'new';
      app.select(table.id, p, mode);
      // Clicking the box in a checkbox cell ticks it straight away, like Numbers.
      if (mode === 'new' && (e.target as Element).closest('[data-check]')) {
        app.toggleCheckboxes([p]);
        return;
      }
      dragging = true;
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  }

  function onMove(e: PointerEvent) {
    if (!dragging) return;
    cancelPress();
    const p = posOf(document.elementFromPoint(e.clientX, e.clientY));
    if (!p) return;
    const last = sel?.ranges[sel.ranges.length - 1];
    if (last && (last.b.r !== p.r || last.b.c !== p.c)) {
      moved = true;
      app.select(table.id, p, 'extend');
    }
  }

  /** The selected cell a touch began on. */
  let tapped: Pos | null = null;

  function onUp(e: PointerEvent) {
    window.removeEventListener('pointermove', onMove);
    cancelPress();
    dragging = false;
    const p = tapped;
    tapped = null;
    if (pressed) {
      pressed = false;
      return;
    }
    if (e.pointerType !== 'touch' || !sel) return;
    if (moved) {
      // A drag from a selected cell extended the selection: show the edit menu for it.
      const pt = cellPoint(sel.anchor);
      openMenu('edit', 'cells', pt.x, pt.y);
      return;
    }
    if (!p) return;
    if (isDoubleTap(p, e.timeStamp)) {
      // Double-tap: edit (focus inside this event so the iPad keyboard appears).
      lastTap = null;
      app.menu = null;
      if (!(e.target as Element).closest?.('[data-check]')) {
        app.select(table.id, p);
        app.startEdit();
      }
      return;
    }
    lastTap = { p, at: e.timeStamp };
    if (menuWasOpen) return; // this tap only hid the menu
    // A tap on the selection shows the edit menu for it.
    const pt = cellPoint(sel.anchor);
    openMenu('edit', 'cells', pt.x, pt.y);
  }

  function onTouchUp(e: PointerEvent) {
    if (e.pointerType !== 'touch' || !pendingTap) return;
    cancelPress();
    if (pressed) {
      pressed = false;
      pendingTap = null;
      return;
    }
    const p = posOf(e.target as Element);
    if (p && p.r === pendingTap.r && p.c === pendingTap.c) {
      // A tap only selects, as in Numbers on iPad; a second tap shows the edit menu.
      app.menu = null;
      app.select(table.id, p);
      if ((e.target as Element).closest('[data-check]')) app.toggleCheckboxes([p]);
      lastTap = { p, at: e.timeStamp };
    }
    pendingTap = null;
  }

  function onContextMenu(e: MouseEvent) {
    e.preventDefault();
    const hit = hitOf(e.target as Element);
    if (hit?.kind === 'line') {
      // Right-click on a row tab or a header: select it (unless already) and show its menu.
      if (app.editing) app.commitEdit();
      if (!app.wholeLines(table.id, hit.axis).includes(hit.i)) app.selectLines(table.id, hit.axis, hit.i);
      openMenu('context', hit.axis === 'row' ? 'rows' : 'columns', e.clientX, e.clientY);
      return;
    }
    const p = posOf(e.target as Element);
    if (!p) return;
    if (app.editing) app.commitEdit();
    if (!selected.has(`${p.r},${p.c}`)) app.select(table.id, p);
    const lines = app.selection?.lines;
    openMenu('context', lines === 'row' ? 'rows' : lines === 'col' ? 'columns' : 'cells', e.clientX, e.clientY);
  }

  function onDblClick(e: MouseEvent) {
    // Double-click a header's edge: fit the column to its contents.
    const h = (e.target as Element).closest<HTMLElement>('[data-colresize]');
    if (h && table.kind === 'table') {
      const col = table.columns[Number(h.dataset.colresize)];
      if (col) app.fitColumnWidths(table.id, [col.id]);
      return;
    }
    const p = posOf(e.target as Element);
    if (!p || (e.target as Element).closest('[data-check]')) return;
    app.select(table.id, p);
    app.startEdit();
  }

  // ----- moving the table by its title bar -----
  let moveStart: { x: number; y: number; tx: number; ty: number; checkpointed: boolean } | null = null;

  let titlePointer = 'mouse';

  /** The table was already selected (and its menu shut or not) when the title was pressed. */
  let titleWasSelected = false;
  let titleMenuWasOpen = false;

  function onTitleDown(e: PointerEvent) {
    if ((e.target as HTMLElement).closest('button, input')) return;
    e.preventDefault();
    app.commitEdit();
    titleMenuWasOpen = app.menuClosedAt === e.timeStamp || (app.menu?.kind === 'edit' && app.menu.target === 'table');
    titleWasSelected = !app.selection && app.focusTableId === table.id;
    app.menu = null;
    titlePointer = e.pointerType;
    if (e.button === 2) return;
    moveStart = { x: e.clientX, y: e.clientY, tx: table.x, ty: table.y, checkpointed: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  /** Selecting the table itself (not cells): Delete, Copy and Cut then act on the whole table. */
  function selectTable() {
    app.selection = null;
    app.focusTableId = table.id;
  }

  function onTitleMove(e: PointerEvent) {
    if (!moveStart || app.readonly || app.maximizedId) return;
    const dx = e.clientX - moveStart.x;
    const dy = e.clientY - moveStart.y;
    if (!moveStart.checkpointed) {
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      app.checkpoint();
      app.bringToFront(table.id);
      moveStart.checkpointed = true;
    }
    // Pointer moves are in screen pixels; table positions are in unzoomed canvas pixels.
    app.moveTable(table.id, moveStart.tx + dx / app.zoom, moveStart.ty + dy / app.zoom);
  }

  function onTitleUp(e: PointerEvent) {
    const wasMove = !!moveStart?.checkpointed;
    if (wasMove) app.save();
    if (moveStart && !wasMove && e.type === 'pointerup') {
      selectTable();
      // Touch: the first tap selects the table; a tap on the selected table shows its menu.
      if (titlePointer === 'touch' && titleWasSelected && !titleMenuWasOpen) {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        openMenu('edit', 'table', r.left + Math.min(r.width, 300) / 2, r.top);
      }
    }
    moveStart = null;
  }

  // ----- renaming the table in place -----
  let draft = $state('');
  let renameEl = $state<HTMLInputElement | null>(null);
  $effect(() => {
    if (app.renamingTableId === table.id) {
      draft = table.name;
      tick().then(() => {
        renameEl?.focus();
        renameEl?.select();
      });
    }
  });
  function finishRename(save: boolean) {
    if (save) app.renameTable(table.id, draft);
    app.renamingTableId = null;
  }
</script>

<div class="frame" data-frame={table.id} class:max={maximized} bind:this={frameEl} style={maximized ? '' : `left:${table.x}px;top:${table.y}px`}>
<div class="table" bind:this={cardEl} class:focused={app.focusTableId === table.id && !maximized}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="title"
    style="height:var(--title-h)"
    onpointerdown={onTitleDown}
    onpointermove={onTitleMove}
    onpointerup={onTitleUp}
    onpointercancel={onTitleUp}
    ondblclick={() => !app.readonly && (app.renamingTableId = table.id)}
    oncontextmenu={(e) => {
      e.preventDefault();
      selectTable();
      openMenu('context', 'table', e.clientX, e.clientY);
    }}
  >
    <span class="grip">⠿</span>
    {#if app.renamingTableId === table.id}
      <input
        class="rename"
        bind:this={renameEl}
        bind:value={draft}
        aria-label="Table name"
        onblur={() => finishRename(true)}
        onkeydown={(e) => {
          if (e.isComposing || e.keyCode === 229) return;
          if (e.key === 'Enter') finishRename(true);
          if (e.key === 'Escape') finishRename(false);
        }}
      />
    {:else}
      <span class="name" title={app.readonly ? table.name : 'Double-click to rename'}>{table.name}</span>
    {/if}
    {#if table.kind === 'cashflow'}<span class="kind">Cashflow</span>{/if}
    <span class="grow"></span>
    {#if table.kind === 'table' && isFiltered(table)}
      <!-- A filtered Table says so in its title; tap to change the filter. -->
      <button class="filtered" title="Rows are filtered — change the filter"
        onpointerdown={(e) => e.stopPropagation()}
        onclick={() => app.openFilter(table.id)}><Icon name="filter" size={14} /> {app.viewItems(table).length} of {table.entries.length}</button>
    {/if}
    <button
      class="max-btn"
      onclick={() => app.toggleMaximize(table.id)}
      title={maximized ? 'Restore (esc)' : 'Fill the window with this table'}
      aria-label={maximized ? 'Restore table size' : 'Fill window with table'}
    >{maximized ? '⤡ Restore' : '⤢'}</button>
  </div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="body"
    bind:this={bodyEl}
    bind:clientWidth={bodyWidth}
    style="--row-h:28px;--rowtab-w:{ROWTAB_W}px"
    class:has-sel={!!sel}
    onpointerdown={onCellDown}
    onpointerup={onTouchUp}
    onpointercancel={() => {
      pendingTap = null;
      cancelPress();
    }}
    ondblclick={onDblClick}
    oncontextmenu={onContextMenu}
  >
    {@render children()}
  </div>
  {#if line?.moved && line.marker && !line.outside}
    <div class="marker" style="left:{line.marker.x}px;top:{line.marker.y}px;width:{line.marker.w}px;height:{line.marker.h}px"></div>
  {/if}
</div>
</div>

<style>
  .frame {
    position: absolute;
  }
  .frame.max {
    position: absolute;
    inset: 0;
  }
  .frame.max .table {
    height: 100%;
    display: flex;
    flex-direction: column;
    border-radius: 0;
    border: none;
  }
  .frame.max .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    -webkit-overflow-scrolling: touch;
  }
  /* Filled view: header rows and the header column stay put while scrolling. */
  /* Layers: body cells < header column (1) < row tabs (2) < header rows (3) < their pinned corners (4, 5). */
  .frame.max .body :global(thead th) {
    position: sticky;
    top: 0;
    z-index: 3;
  }
  .frame.max .body :global(thead tr:nth-child(2) th) {
    top: var(--row-h);
  }
  /* Fill Window: columns are fitted to the width; text, files and labels wrap. */
  .frame.max .body :global(td.wrap),
  .frame.max .body :global(th.wrap) {
    white-space: normal;
    overflow-wrap: anywhere;
    text-overflow: clip;
    padding-top: 4px;
    padding-bottom: 4px;
  }
  /* Fill Window: the row tabs and the header column stay put while scrolling sideways. */
  .frame.max .body :global(.rowtab) {
    position: sticky;
    left: 0;
    z-index: 2;
  }
  .frame.max .body :global(td.header-col),
  .frame.max .body :global(tfoot td[data-c='0']) {
    position: sticky;
    left: var(--rowtab-w);
    z-index: 1;
  }
  .frame.max .body :global(thead th[data-coltab='0']) {
    left: var(--rowtab-w);
    z-index: 4;
  }
  .frame.max .body :global(thead th.rowtab) {
    z-index: 5;
  }
  /* Row tabs: the first column of every table (row numbers). */
  .body :global(.rowtab) {
    padding: 0;
    text-align: center;
    font-size: 11px;
    font-weight: 500;
    color: var(--muted);
    background: var(--head);
    cursor: grab;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
  }
  .body :global(tfoot .rowtab),
  .body :global(thead .rowtab) {
    cursor: default;
  }
  /* The header row is the column tab. */
  .body :global(th.coltab) {
    cursor: default;
    touch-action: none;
  }
  .body :global(th[data-h]) {
    cursor: grab;
  }
  .body :global(.rowtab.on),
  .body :global(th.coltab.on) {
    background: var(--accent);
    color: var(--on-accent);
  }
  /* Where a dragged row or column will land. */
  .marker {
    position: absolute;
    z-index: 5;
    background: var(--accent);
    border-radius: 2px;
    pointer-events: none;
  }
  .grow {
    flex: 1;
  }
  .filtered {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: none;
    background: var(--accent-soft);
    color: var(--accent);
    border-radius: var(--radius-10);
    min-height: 22px;
    padding: 0 8px;
    font-size: 12px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  @media (pointer: coarse) {
    .filtered {
      min-height: var(--touch-target);
    }
  }
  .max-btn {
    border: none;
    background: none;
    color: var(--muted);
    min-height: 26px;
    padding: 0 6px;
  }
  @media (pointer: coarse) {
    .max-btn {
      min-height: var(--touch-target);
      min-width: var(--touch-target);
    }
  }
  .table {
    position: relative;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius-8);
    box-shadow: var(--shadow-rest);
    overflow: hidden;
  }
  .table.focused {
    border-color: var(--accent);
    box-shadow: var(--focus-halo);
  }
  .title {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px;
    font-weight: 600;
    cursor: grab;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    border-bottom: 1px solid var(--line);
  }
  .rename {
    min-height: 0;
    font: inherit;
    font-weight: 600;
    border: 1px solid var(--accent);
    border-radius: var(--radius-4);
    padding: 1px 6px;
    min-width: 200px;
  }
  .grip {
    color: var(--muted);
    font-size: 12px;
  }
  .kind {
    font-size: 11px;
    font-weight: 500;
    color: var(--muted);
    border: 1px solid var(--line);
    border-radius: var(--radius-4);
    padding: 0 5px;
  }
  /* Shared cell styles for both kinds of grid. */
  .body :global(table) {
    border-collapse: collapse;
    table-layout: fixed;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    font-variant-numeric: tabular-nums;
  }
  .body :global(th),
  .body :global(td) {
    border-right: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
    padding: 0 8px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .body :global(th) {
    background: var(--head);
    font-weight: 600;
    color: var(--muted);
  }
  .body :global(td) {
    position: relative;
    cursor: cell;
    touch-action: pan-x pan-y;
  }
  .body :global(td.sel) {
    touch-action: none;
    background-image: linear-gradient(var(--accent-soft), var(--accent-soft));
  }
  .body :global(td.anchor) {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .body :global(.right) {
    text-align: right;
  }
  .body :global(.center) {
    text-align: center;
  }
  /* The first column is a header column, as in Numbers. */
  .body :global(td.header-col) {
    background-color: var(--head-col);
    font-weight: 600;
  }
  .body :global(td.neg) {
    color: var(--neg);
  }
  .body :global(tfoot td) {
    background-color: var(--foot);
    font-weight: 600;
    cursor: default;
  }
  .body :global(tfoot tr.first td) {
    border-top: 2px solid var(--line-strong);
  }
</style>