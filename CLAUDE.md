# CLAUDE.md

**Cashflow** — a cash-flow tracker/forecast web app: sheets of free-placed (grid-snapped) tables on a canvas, months as columns.
Single editor (the owner) on Mac + iPad; others will get view-only links (last phase).
The GitHub repository is `izzln/cashflow`; the Worker is `cashflow` (https://cashflow.stories.workers.dev once the
account's workers.dev subdomain is `stories`). The D1 database and browser storage keys keep the old
`cashflow-allseeing` name on purpose: renaming keys or the export format would orphan saved files and settings.

## Names
A **Cashflow** is the special month-by-month table (`CashflowTable`, `kind: 'cashflow'`). A **Table** is rows with
typed columns (`DataTable`, `kind: 'table'`; its rows are `entries`). `Table` in code means either kind.
There are no saved files to stay compatible with yet, so formats can still change freely.

## Design system: Stories Web App
All UI rules, tokens, components, HIG deviations and known gaps come from the **Stories Web App** design system:
https://claude.ai/artifact/MP8LwEVe4W4Ffw9RFyb7ij (a private Design System artifact; read it with the Artifact tool,
`action: "read"` with `path`). Before UI work read `project/README.md`, `project/tokens.json` and the
`project/components/<Name>/README.md` of each component you touch. **Where this file or the code disagrees with it,
Stories Web App wins.** Don't copy its rules here; this file only adds what is specific to this app.
**Never change Stories Web App unless the owner asks for it in so many words.** When the app needs to differ from it,
record the difference below as the owner's decision and mention it; don't edit the design system to match.

### App-specific UI (not in the design system)
- **Accent override (owner's decision):** the accent is green like Numbers — `--accent: #1b7a43`,
  `--accent-soft: rgba(27,122,67,.12)` (white on it 5.37:1; on its soft tint 4.55:1). Every other token is Stories'.
  Tokens live in `src/app.css`; components use `var(--…)`, never raw values.
- Commands are defined once in `src/lib/commands.ts`; the toolbar's overflow order is `OVERFLOW_ORDER` in
  `src/components/Toolbar.svelte`.
- Cashflow markers: ⇄ from a table (`#1d63c7`), ƒ formula (`#6941c6`), negative in a linked/formula cell (`#b8336a`),
  ✎ number typed over a linked row (`#b54708`), `#ERR` for a formula/source error (reason in tooltip and Inspector).
- Touch selection (Stories: Input model): `app.menuClosedAt` lets the tap that closed the EditMenu not reopen it;
  cells in `TableFrame` (`onCellDown`/`onUp`), tabs in `onLineDown`, the table title in `onTitleDown`.
- Cashflow grid: label column 200px, month columns 100px, two header rows (year, month; centred).
  Header-row text is always centred in both kinds of table (owner's decision), whatever the column type.
- Canvas: tables snap to a 20px grid; a 40px margin surrounds the zoomed canvas. Zoom 25–400 %
  (steps 25, 50, 75, 100, 125, 150, 200, 300, 400), per sheet (localStorage per file; scroll per sheet while open).
- Row/column tabs (Stories: DataTable, deviation 6): `ROWTAB_W`; `th[data-rowtab]` (not a model column),
  `th[data-coltab]`, Cashflow `data-years` and the label corner (`data-coltab="0"`), `data-tabcorner`. Input in
  `TableFrame` (`onLineDown`); the drag label is `app.lineGhost` (drawn by Canvas). Cashflow months don't reorder.
- Fill Window (one table fills the canvas, headers and first column pinned): Esc never leaves it; only Restore does.
  Each sheet remembers its filled table, per file across closing it (localStorage, like zoom and the active
  sheet). Fill / Restore zooms the card from its old rectangle (`app.fillFrom`, `zoomFrom` in `src/lib/motion.ts`). Columns are fitted to the width (`fitColumns` in `src/lib/grid.ts`):
  text, files and row labels wrap and give up width first; numbers, dates and checkboxes never wrap.
  Row tabs, the header column and the header rows are sticky; drags only reorder there (no drag-out) and scroll
  near an edge. Tables carry an explicit width so `table-layout: fixed` holds and wide tables scroll.
- Text alignment (Left / Center / Right) applies to text, date and row-label cells only, per cell
  (`aligns`, keyed like `styles`); ⌘{ ⌘| ⌘}, the Format popover, the Align submenu and the Inspector.
- Deletes are undoable and show a notice with Undo. Files (Home) and snapshots (File menu, which also shows Undo
  in place) are removed for good only when the notice expires or the page/file closes.
- Clipboard (Stories: Clipboard): `src/lib/clipboard.ts` (`toHTML` with `data-cf-s` / `data-cf-a`,
  `formatsFromHTML`), `execCopy` / `pasteClipboard` in `commands.ts`, ⌘C/⌘X/⌘V and the `before*` events in App,
  `app.copiedText` / `copyReachedSystem` for the in-window fallback.
- Size class: `app.sizeClass` from the measured container width (`app.width`); CSS uses `max-width: 599px`.
- Column formats (Stories: DataTable): `Column.format` (number), `numbering` (parts + start; cells hold the row's
  number, given once by `assignNumbers`, which `app.change()` runs on every Table), `options` / `defaultOption`
  (Pop-Up Menu; cells hold the label; `newEntryFor` applies the default; `OptionsPopover` edits a cell).
  Settings UI: `ColumnFormat`, ordered lists via `ReorderList`.
- Conditions (`Condition`, `matchCond` / `condOps` in `columns.ts`) drive both `highlights` (first match wins, over the
  cell's own tint; `HighlightRules`) and the row filter `filter` (`SortFilter`, `app.openFilter`).
- **Home shows file icons (owner's decision, like Finder / Numbers; Stories' List is a list page):** a grid of page
  pictures (`thumbnailSVG` in `src/lib/thumbnail.ts`: the first sheet's tables as shapes, no text; cached per device by
  `updatedAt`) with the name below. Pointer: click selects, double-click opens; touch: tap opens; right-click /
  long-press opens the file menu (the only place for Rename / Duplicate / Download / Delete). No list view, no
  tips. Opening marks the icon at once and shows a spinner on it after 500ms.
- New files start blank: one empty sheet, "Sheet 1" (`starterWorkbook`); an empty sheet shows a one-line hint.
- **Side panel (owner's decision):** `app.panel` is 'inspector' | 'filter' | null. The Inspector has a Table / Cell
  segmented control (`app.inspectorTab`; Stories' Inspector stacks one section per level): Table = name, opening
  balance / import, conditional highlighting; Cell = cashflow row/cell/footer settings, a Table column's Data Format,
  text alignment. The toolbar's Filter button shows Sort & Filter in the same panel (`SortFilter`): sort rules
  (`DataTable.sort`, applied on change and with Sort Now; multi-key, stable) and the row filter. Structure edits
  (rows, columns, delete table) live in the toolbar and menus only.
- **Column widths:** `Column.width` (drag the header's right edge — `onResizeDown` in TableFrame, one undo step —
  or Fit Width to Content: double-click the edge / `table.fitColumns`, `bestFitWidth`). Unset = the type's default.
  Fill Window sizes columns from their contents (`fillSpec`): non-text columns never go below their content
  (headers may wrap to two lines); text and files give up width first but stay within about three lines.
- **Filtered Tables:** `dataTableModel` and the grid work on the shown rows (`visibleEntries`); row index r means
  `app.viewItems(t)[r]`, never `t.entries[r]`. Row operations map shown rows to entry ids. Rows added while filtered
  stay shown (`keepRows`) until the filter changes. The Total row sums shown rows; cashflow sources ignore filters.

## Commands
- `npm test` (vitest, tests/), `npm run check` (svelte-check + worker tsc), `npm run build`
- `npm run dev:server` — Worker + local D1 on :8787 (secrets in `.dev.vars`, gitignored); `npm run deploy`

## Layout
- `src/lib/months.ts` — 'YYYY-MM' month keys; visible window = current month → Dec next year
- `src/lib/evaluate.ts` — `Evaluator`: every computed cell (manual / table source / formula rows, net cash flow,
  balance carried from openingMonth incl. hidden months, footer formulas); memoized, cycle-safe, errors as `{err}`
- `src/lib/formula.ts` — formula tokenizer/parser/evaluator (`[Row]`, `[Table].[Row]`, PREV, SUM…; full-width input)
- `src/lib/dates.ts`, `src/lib/import/` — date parsing, CSV (GBK fallback), minimal .xlsx reader, column mapping
- `src/lib/columns.ts` — table column types (date/number/text/checkbox/files): parse, display, convert, filters
- `src/lib/commands.ts` — every command (id, label, shortcut, enabled, run) + context / edit menu layouts
- `src/lib/attachments.ts` — attachment bytes: server (`/api/files/:id/attachments`, D1 chunks) or IndexedDB
- `src/lib/sync.ts` — `SyncLoop`: per-file timer, one window via Web Locks
- `src/lib/remote.ts` — `RemoteFileStore` (fetch `/api`, BroadcastChannel + 15 s polling for `watch`);
  `src/lib/session.svelte.ts` picks local vs remote at startup (`/api/session`), sign-in, local→server upload
- `worker/` — Cloudflare Worker: `/api` routes (files, snapshots, month-end, login), `auth.ts` (signed cookie);
  schema in `migrations/`. The Worker never parses workbook JSON (free-plan CPU limit); it stores it as text.
  It also serves the built app, embedded by `scripts/embed-assets.mjs` into `worker/static.generated.ts`
  (generated, gitignored) with a strict CSP. Deploy: `npm run deploy` (needs CLOUDFLARE_API_TOKEN)
- `src/lib/files.ts` — files: `FileStore` interface (async; `RemoteFileStore` is the server version),
  `LocalFileStore` over localStorage, per-file `rev`, in-file snapshots (manual + month-end), export format
- `src/lib/merge.ts` — 3-way JSON merge (objects by key, id'd arrays by id); used for multi-window edits and undo
- `src/lib/model.ts` — Workbook/Sheet/Table types: `Table = CashflowTable | DataTable` (by `kind`); data tables have
  typed `columns` and `entries[].cells`; `RowSource` (monthly sums) / `CellSource` (one column total) with `filters`
  and the source table's `tableId`; `normalizeWorkbook` validates loaded JSON
- `src/lib/grid.ts` — `GridModel` per table kind (rows/cols/value/raw/editable/set); selection, editing, paste,
  copy, styles and undo work through it. Cash: r = body rows, 2 fixed footers, custom footers; c = 0 label, 1.. months.
  Data table: r = entries, then Total; c = the table's columns
- `src/lib/store.svelte.ts` — single app state (Svelte 5 runes): selection, editing, undo (snapshots), paste, persistence
- `src/components/` — App (hash routing `#/` list, `#/f/<id>` editor, `#/f/<id>/s/<sid>` read-only snapshot; keyboard + clipboard),
  Home (file list), TopBar (back, FileMenu, Toolbar with measured overflow), SheetTabs row, Icon, MenuList / PopupMenus (context + touch
  edit menu), Canvas (zoom: scaled content; cell editor; filled view; drag label), TableFrame
  (title, drag, pointer/touch selection, row/column tab input) with CashflowGrid / TableGrid, Inspector + SourcePicker, ImportDialog,
  FilesPopover, StatusBar

## Conventions
- Every user-visible data change goes through `app.change(fn)` so it is undoable and saved; `save()` bumps
  `app.version`, which rebuilds `app.ev` (the Evaluator). Don't read computed values from anywhere else.
- All storage goes through `fileStore` (switchable: `LocalFileStore` or `RemoteFileStore`); change notices via `fileStore.watch`.
- Saves pass the `rev` they started from; a mismatch means another window saved first → load, `merge3(base, mine, theirs)`, retry.
  Storage events from other windows are merged the same way. Undo = `merge3(after, before, current)`, so it reverts only this window's change.
- Month-end rule: before the first save of a new month (and on open), freeze the stored content as last month's snapshot.
- Read-only (snapshot) windows: `app.readonly`; `change()` and editing refuse to run.
- Selection and the open cell editor are remapped by row id when content is replaced.
- Zoom (`app.zoom`, 0.25–4): table positions and the cell editor are in unzoomed canvas pixels; convert pointer
  deltas and drop points with `/ app.zoom`.
- Outflows are negative numbers. Amounts are stored per month on the row; months outside the window are kept.
  On a source row, `values` are manual overrides. Formula rows count toward net cash flow; footer formulas don't.
- The cell editor is one persistent `<input>` laid over the cell (the design system's focus/IME rules apply).
- Keep dependencies minimal; prefer small in-house code over UI/grid libraries.
