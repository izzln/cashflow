<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { app } from '../lib/store.svelte';
  import { buildExport, exportFilename, fileStore, fromExport, importedName, localFileStore, type FileMeta } from '../lib/files';
  import { downloadText } from '../lib/download';
  import { session } from '../lib/session.svelte';
  import StatusBar from './StatusBar.svelte';
  import { thumbnailSVG } from '../lib/thumbnail';
  import { fadeOut } from '../lib/motion';

  let files = $state<FileMeta[]>([]);
  let loaded = $state(false);
  let error = $state('');
  let importEl = $state<HTMLInputElement | null>(null);
  let localOnly = $state<FileMeta[]>([]);
  let uploading = $state(false);
  /** A failed action, shown at the top of the list until dismissed. */
  let problem = $state('');

  async function refresh() {
    try {
      files = await fileStore.list();
      error = '';
      localOnly = await session.localOnlyFiles();
    } catch (e) {
      error = (e as Error).message || 'Could not load your files.';
    }
    loaded = true;
    void loadThumbs(files);
  }

  // ----- icons (the default view, like Finder and Numbers) or a list -----
  const VIEW_KEY = 'cashflow-allseeing.homeView';
  const THUMB_KEY = 'cashflow-allseeing.thumb.';
  function readView(): 'icons' | 'list' {
    try {
      return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'icons';
    } catch {
      return 'icons';
    }
  }
  let view = $state<'icons' | 'list'>(readView());
  function setView(v: 'icons' | 'list') {
    view = v;
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Not remembered; fine.
    }
  }

  /** Each file's picture, drawn from its first sheet and cached on this device until the file changes. */
  let thumbs = $state<Record<string, string>>({});
  async function loadThumbs(list: FileMeta[]) {
    for (const f of list) {
      const key = THUMB_KEY + f.id;
      try {
        const cached = JSON.parse(localStorage.getItem(key) ?? 'null');
        if (cached && cached.at === f.updatedAt && typeof cached.svg === 'string') {
          thumbs[f.id] = cached.svg;
          continue;
        }
      } catch {
        // Fall through and draw it.
      }
      try {
        const doc = await fileStore.load(f.id);
        if (!doc) continue;
        const svg = thumbnailSVG(doc.wb);
        thumbs[f.id] = svg;
        try {
          localStorage.setItem(key, JSON.stringify({ at: f.updatedAt, svg }));
        } catch {
          // Storage full: draw it again next time.
        }
      } catch {
        // Offline or gone: keep the plain page.
      }
    }
  }

  // ----- selection and the file menu (right-click, long-press) -----
  let selectedId = $state<string | null>(null);
  let fileMenu = $state<{ f: FileMeta; x: number; y: number } | null>(null);
  /** The menu last shown: it keeps the closing menu's contents while it fades out. */
  let lastMenu = $state<{ f: FileMeta; x: number; y: number } | null>(null);
  let menuOpenedAt = 0;
  let press: { timer: ReturnType<typeof setTimeout>; x: number; y: number; fired: boolean } | null = null;

  function openFileMenu(f: FileMeta, x: number, y: number) {
    selectedId = f.id;
    fileMenu = { f, x: Math.max(8, Math.min(x, window.innerWidth - 240)), y: Math.max(8, Math.min(y, window.innerHeight - 280)) };
    lastMenu = fileMenu;
    menuOpenedAt = performance.now();
  }
  function closeFileMenu() {
    fileMenu = null;
  }
  function menuBackdrop() {
    // The tap that opened the menu (a long-press) is followed by a click: ignore it.
    if (performance.now() - menuOpenedAt > 400) closeFileMenu();
  }

  function tileDown(e: PointerEvent, f: FileMeta) {
    if (e.button === 2 || renamingId === f.id) return;
    const { clientX: x, clientY: y } = e;
    if (press) clearTimeout(press.timer);
    press = { x, y, fired: false, timer: setTimeout(() => {
      if (press) press.fired = true;
      openFileMenu(f, x, y);
    }, 550) };
  }
  function tileMove(e: PointerEvent) {
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) {
      clearTimeout(press.timer);
      press = null;
    }
  }
  /** Pointer: a click selects, a double-click opens. Touch: a tap opens (as on iPad). */
  function tileUp(e: PointerEvent, f: FileMeta) {
    const p = press;
    press = null;
    if (!p) return;
    clearTimeout(p.timer);
    if (p.fired || renamingId === f.id) return;
    if (e.pointerType === 'touch') open(f.id);
    else selectedId = f.id;
  }


  /** Run a file action, turning failures into a message instead of a silent no-op. */
  async function attempt(fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (e) {
      problem = (e as Error).message || 'That did not work. Check the connection and try again.';
    }
    refresh();
  }

  /** Copy files kept in this browser (from before the server) to the server, with their snapshots. */
  async function upload() {
    uploading = true;
    let done = 0;
    try {
      for (const f of localOnly) {
        const data = await buildExport(localFileStore, f.id);
        if (!data) continue;
        const names = (await fileStore.list()).map((x) => x.name);
        await fileStore.create(
          importedName(data.name, names),
          data.workbook,
          data.snapshots.map((s) => ({ meta: s.meta, wb: s.workbook })),
        );
        session.markUploaded(f.id);
        done++;
      }
    } catch (e) {
      problem = `Uploaded ${done} file(s), then: ${(e as Error).message}`;
    }
    uploading = false;
    refresh();
  }

  function open(id: string) {
    location.hash = `#/f/${id}`;
  }

  /** A new file opens straight away as "Untitled", with its name ready to type over (no prompt). */
  async function create() {
    const names = files.map((f) => f.name);
    let name = 'Untitled';
    for (let i = 2; names.includes(name); i++) name = `Untitled ${i}`;
    await attempt(async () => {
      const meta = await fileStore.create(name);
      app.fileMenuRequest = 'rename';
      open(meta.id);
    });
  }

  // ----- rename in place -----
  let renamingId = $state<string | null>(null);
  let draft = $state('');
  let renameEl = $state<HTMLInputElement | null>(null);

  async function startRename(f: FileMeta) {
    renamingId = f.id;
    draft = f.name;
    await tick();
    renameEl?.focus();
    renameEl?.select();
  }

  async function finishRename(save: boolean) {
    const id = renamingId;
    renamingId = null;
    const f = files.find((x) => x.id === id);
    if (save && f && draft.trim() && draft.trim() !== f.name) await attempt(() => fileStore.rename(f.id, draft.trim()));
  }

  /**
   * Delete is undoable (Stories: List): the file leaves the list at once and is removed for good
   * when the Undo notice expires, or when this page closes.
   */
  let pendingDelete = $state<{ f: FileMeta; timer: ReturnType<typeof setTimeout> } | null>(null);
  const shown = $derived(files.filter((f) => f.id !== pendingDelete?.f.id));

  async function duplicate(f: FileMeta) {
    await attempt(() => fileStore.duplicate(f.id));
  }

  async function download(f: FileMeta) {
    await attempt(async () => {
      const data = await buildExport(fileStore, f.id);
      if (data) downloadText(exportFilename(f.name), JSON.stringify(data, null, 2));
    });
  }

  async function remove(f: FileMeta) {
    await commitDelete();
    const timer = setTimeout(() => void commitDelete(), 6000);
    pendingDelete = { f, timer };
    app.flashNotice(`Deleted “${f.name}”.`, 'info', {
      label: 'Undo',
      run: () => {
        if (pendingDelete?.f.id !== f.id) return;
        clearTimeout(timer);
        pendingDelete = null;
      },
    });
  }

  async function commitDelete() {
    const p = pendingDelete;
    if (!p) return;
    clearTimeout(p.timer);
    pendingDelete = null;
    await attempt(() => fileStore.remove(p.f.id));
  }

  async function importFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const data = fromExport(JSON.parse(await file.text()), file.name.replace(/\.json$/i, ''));
      if (!data) throw new Error('not a cashflow file');
      const names = (await fileStore.list()).map((f) => f.name);
      const meta = await fileStore.create(importedName(data.name, names, data.exportedAt), data.wb, data.snapshots);
      open(meta.id);
    } catch (err) {
      problem = err instanceof SyntaxError || (err as Error).message === 'not a cashflow file' ? 'That is not a Cashflow file.' : (err as Error).message;
    }
  }

  const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const fmtDay = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

  onMount(() => {
    refresh();
    const unwatch = fileStore.watch((e) => {
      if (e.kind === 'list' || e.kind === 'file') refresh();
    });
    document.title = 'Cashflow — Files';
    const onHide = () => void commitDelete();
    window.addEventListener('pagehide', onHide);
    return () => {
      unwatch();
      window.removeEventListener('pagehide', onHide);
      void commitDelete();
    };
  });
</script>

<main class="home">
  <header>
    <h1>Cashflow</h1>
    <div class="actions">
      <button class="primary" onclick={create}>+ New file</button>
      <button onclick={() => importEl?.click()}>Import file…</button>
      <input bind:this={importEl} type="file" accept="application/json,.json" hidden onchange={importFile} />
      {#if session.mode === 'remote'}<button onclick={() => session.logout()}>Sign out</button>{/if}
    </div>
  </header>

  {#if localOnly.length}
    <div class="banner">
      <span>
        {localOnly.length} file{localOnly.length === 1 ? ' is' : 's are'} saved only in this browser
        ({localOnly.map((f) => f.name).join(', ')}). Upload {localOnly.length === 1 ? 'it' : 'them'} so
        {localOnly.length === 1 ? 'it shows' : 'they show'} on all your devices. The browser copy is kept.
      </span>
      <button class="primary" disabled={uploading} onclick={upload}>{uploading ? 'Uploading…' : 'Upload'}</button>
    </div>
  {/if}

  {#if error}<p class="error">{error} <button onclick={refresh}>Try again</button></p>{/if}
  {#if problem}<p class="error" role="alert">{problem} <button onclick={() => (problem = '')}>OK</button></p>{/if}

  {#if loaded && !error && shown.length === 0}
    <p class="empty">No files yet. Create one, or import a downloaded file.</p>
  {/if}

  {#if shown.length}
    <div class="viewbar">
      <div class="segmented" role="radiogroup" aria-label="View">
        <button role="radio" aria-checked={view === 'icons'} class:on={view === 'icons'} onclick={() => setView('icons')}>Icons</button>
        <button role="radio" aria-checked={view === 'list'} class:on={view === 'list'} onclick={() => setView('list')}>List</button>
      </div>
    </div>
  {/if}

  {#if view === 'icons'}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
    <ul class="icons" onclick={(e) => e.target === e.currentTarget && (selectedId = null)}>
      {#each shown as f (f.id)}
        <li class="tile" class:sel={selectedId === f.id}>
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="hit" title={f.name}
            onpointerdown={(e) => tileDown(e, f)} onpointermove={tileMove} onpointerup={(e) => tileUp(e, f)}
            onpointercancel={() => { if (press) clearTimeout(press.timer); press = null; }}
            ondblclick={() => open(f.id)}
            oncontextmenu={(e) => { e.preventDefault(); openFileMenu(f, e.clientX, e.clientY); }}>
            <div class="thumb">
              {#if thumbs[f.id]}{@html thumbs[f.id]}{/if}
            </div>
            {#if renamingId === f.id}
              <input class="rename tilename" bind:this={renameEl} bind:value={draft} aria-label="File name"
                onpointerdown={(e) => e.stopPropagation()}
                onblur={() => finishRename(true)}
                onkeydown={(e) => {
                  if (e.isComposing || e.keyCode === 229) return;
                  if (e.key === 'Enter') finishRename(true);
                  if (e.key === 'Escape') finishRename(false);
                }} />
            {:else}
              <span class="fname">{f.name}</span>
            {/if}
            <span class="fwhen">{fmtDay.format(f.updatedAt)}</span>
          </div>
        </li>
      {/each}
    </ul>
  {:else}
    <ul class="list">
      {#each shown as f (f.id)}
        <li oncontextmenu={(e) => { e.preventDefault(); openFileMenu(f, e.clientX, e.clientY); }}>
          {#if renamingId === f.id}
            <input class="rename" bind:this={renameEl} bind:value={draft} aria-label="File name"
              onblur={() => finishRename(true)}
              onkeydown={(e) => {
                if (e.isComposing || e.keyCode === 229) return;
                if (e.key === 'Enter') finishRename(true);
                if (e.key === 'Escape') finishRename(false);
              }} />
          {:else}
            <a class="name" href="#/f/{f.id}" ondblclick={(e) => { e.preventDefault(); startRename(f); }}>{f.name}</a>
          {/if}
          <span class="when">Edited {fmt.format(f.updatedAt)}</span>
          <span class="buttons">
            <a class="btn" href="#/f/{f.id}" target="_blank" rel="noopener" title="Open in a new window">New Window</a>
            <button onclick={() => startRename(f)}>Rename…</button>
            <button onclick={() => duplicate(f)}>Duplicate</button>
            <button onclick={() => download(f)}>Download</button>
            <button class="danger" onclick={() => remove(f)}>Delete</button>
          </span>
        </li>
      {/each}
    </ul>
  {/if}

  {#if fileMenu && lastMenu}
    {@const f = lastMenu.f}
    <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
    <div class="backdrop" onclick={menuBackdrop} oncontextmenu={(e) => { e.preventDefault(); closeFileMenu(); }}></div>
    <ul class="menu" role="menu" aria-label={f.name} style="left:{lastMenu.x}px;top:{lastMenu.y}px" out:fadeOut>
      <li role="none"><button role="menuitem" onclick={() => { closeFileMenu(); open(f.id); }}>Open</button></li>
      <li role="none"><a role="menuitem" href="#/f/{f.id}" target="_blank" rel="noopener" onclick={closeFileMenu}>Open in New Window</a></li>
      <li class="sep" role="separator"></li>
      <li role="none"><button role="menuitem" onclick={() => { closeFileMenu(); startRename(f); }}>Rename…</button></li>
      <li role="none"><button role="menuitem" onclick={() => { closeFileMenu(); duplicate(f); }}>Duplicate</button></li>
      <li role="none"><button role="menuitem" onclick={() => { closeFileMenu(); download(f); }}>Download a Copy</button></li>
      <li class="sep" role="separator"></li>
      <li role="none"><button role="menuitem" class="danger" onclick={() => { closeFileMenu(); remove(f); }}>Delete</button></li>
    </ul>
  {/if}

  <p class="note">
    {#if session.mode === 'remote'}
      Files are saved on your server and show up on every device you sign in on. Download a file (it
      includes its snapshots) to keep your own copy. Importing always creates a new file and never
      overwrites one.
    {:else}
      Files are stored in this browser, so each device has its own list. Download a file (it includes
      its snapshots) to move it to another device or keep a copy. Importing always creates a new file
      and never overwrites one.
    {/if}
  </p>
</main>
<StatusBar />

<style>
  .home {
    height: 100%;
    overflow-y: auto;
    max-width: var(--page-w);
    margin: 0 auto;
    padding: calc(24px + env(safe-area-inset-top)) 16px 40px;
  }
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
  }
  h1 {
    font-size: 22px;
    margin: 0;
  }
  .actions {
    display: flex;
    gap: 8px;
  }
  .primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
  }
  .viewbar {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 10px;
  }
  .segmented {
    display: flex;
  }
  .segmented button {
    border-radius: 0;
    margin-left: -1px;
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
  /* Icon view (owner's decision, like Finder / Numbers): a page picture with the name below. */
  .icons {
    list-style: none;
    margin: 0;
    padding: 4px 0 8px;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 18px 12px;
  }
  .tile {
    display: flex;
    justify-content: center;
  }
  .hit {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    width: 150px;
    padding: 8px 6px;
    border-radius: var(--radius-10);
    cursor: default;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    touch-action: manipulation;
  }
  .thumb {
    width: 128px;
    height: 96px;
    border-radius: var(--radius-6);
    background: var(--panel);
    border: 1px solid var(--line);
    box-shadow: var(--shadow-rest);
    overflow: hidden;
  }
  .thumb :global(svg) {
    display: block;
    width: 100%;
    height: 100%;
  }
  .fname {
    max-width: 100%;
    text-align: center;
    overflow-wrap: anywhere;
    line-height: 1.3;
    padding: 1px 6px;
    border-radius: var(--radius-4);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .fwhen {
    color: var(--muted);
    font-size: 12px;
  }
  .tile.sel .thumb {
    outline: 3px solid var(--accent-soft);
    outline-offset: 2px;
  }
  .tile.sel .fname {
    background: var(--accent);
    color: var(--on-accent);
  }
  .tilename {
    width: 100%;
    text-align: center;
  }
  /* The file menu (right-click or long-press): Stories ContextMenu rows. */
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
    min-width: var(--menu-min-w);
    background: var(--menu-bg);
    border: 1px solid var(--line);
    border-radius: var(--radius-10);
    box-shadow: var(--shadow-menu);
    -webkit-backdrop-filter: blur(20px);
    backdrop-filter: blur(20px);
  }
  .menu button,
  .menu a {
    display: flex;
    align-items: center;
    width: 100%;
    border: none;
    background: none;
    border-radius: var(--radius-5);
    padding: 4px 8px 4px 28px;
    min-height: var(--row-h);
    text-align: left;
    color: inherit;
    text-decoration: none;
    cursor: default;
  }
  @media (pointer: coarse) {
    .menu button,
    .menu a {
      min-height: var(--touch-target);
    }
  }
  .menu button:hover,
  .menu button:active,
  .menu a:hover,
  .menu a:active {
    background: var(--accent);
    color: var(--on-accent);
  }
  .menu button.danger {
    color: var(--neg);
  }
  .menu button.danger:hover,
  .menu button.danger:active {
    background: var(--neg);
    color: var(--on-accent);
  }
  .menu .sep {
    height: 1px;
    background: var(--line);
    margin: 4px 6px;
  }
  .list {
    list-style: none;
    padding: 0;
    margin: 0;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius-10);
  }
  .list:empty {
    display: none;
  }
  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 14px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--line);
  }
  li:last-child {
    border-bottom: none;
  }
  .name {
    font-weight: 600;
    font-size: 15px;
    color: var(--text);
    text-decoration: none;
    flex: 1 1 200px;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .when {
    color: var(--muted);
    font-size: 12px;
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--line);
    background: var(--panel);
    border-radius: var(--radius-6);
    padding: 4px 10px;
    min-height: var(--control-h);
    color: inherit;
    text-decoration: none;
  }
  .banner {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
    justify-content: space-between;
    background: var(--banner-bg);
    border: 1px solid var(--banner-line);
    border-radius: var(--radius-10);
    padding: 10px 14px;
    margin-bottom: 14px;
    line-height: 1.5;
  }
  .error {
    color: var(--neg);
  }
  .rename {
    flex: 1 1 200px;
    font-weight: 600;
    font-size: 15px;
    border: 1px solid var(--accent);
    border-radius: var(--radius-6);
    padding: 4px 8px;
  }
  .empty,
  .note {
    color: var(--muted);
    line-height: 1.5;
  }
  .note {
    margin-top: 16px;
    font-size: 12px;
  }
</style>
