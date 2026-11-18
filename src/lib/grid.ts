import { isErr, type CellValue, type Evaluator } from './evaluate';
import { parseNumber } from './format';
import { cellDisplay, cellRaw, cellValue, matchCond, optionFor, parseCell } from './columns';
import { newEntry, newRow, uid, type CashflowTable, type CellData, type ColumnType, type Column, type DataTable, type Entry, type Table } from './model';
import type { MonthKey } from './months';

/** Cell position inside a table. r: body rows, then footer rows. c: column. */
export interface Pos {
  r: number;
  c: number;
}

export interface Range {
  a: Pos;
  b: Pos;
}

export const FIXED_FOOTERS = [
  { id: '__cashflow', label: 'Net cash flow' },
  { id: '__balance', label: 'Balance' },
] as const;

const TYPE_WIDTH: Record<ColumnType, number> = { date: 112, number: 120, text: 160, checkbox: 90, files: 190, numbering: 110, select: 140 };

/** Cell kinds that take a text alignment (numbers stay right, checkboxes centred). */
export const ALIGNABLE: string[] = ['text', 'date', 'label', 'numbering', 'select'];

/**
 * The rows a Table shows: all of them, or those passing its row filter while it is on.
 * `keep` holds rows added while filtering, which stay in view until the filter changes.
 */
export function visibleEntries(t: DataTable, keep?: Set<string>): Entry[] {
  const f = t.filter;
  if (!f?.on || !f.rules.length) return t.entries;
  return t.entries.filter((e) => {
    if (keep?.has(e.id)) return true;
    return f.any ? f.rules.some((c) => matchCond(e, t.columns, c)) : f.rules.every((c) => matchCond(e, t.columns, c));
  });
}

export const isFiltered = (t: DataTable) => !!t.filter?.on && t.filter.rules.length > 0;

/** A new Table row, with each Pop-Up Menu column's default choice. */
export function newEntryFor(t: DataTable): Entry {
  const e = newEntry();
  for (const c of t.columns) {
    if (c.type !== 'select' || !c.defaultOption) continue;
    const o = c.options?.find((x) => x.id === c.defaultOption);
    if (o) e.cells[c.id] = o.label;
  }
  return e;
}

/**
 * Give every row of each Numbering column that has no number yet the next one, in table order.
 * Numbers stick once given (sorting, moving or deleting rows never renumbers). Returns true if any changed.
 */
export function assignNumbers(t: DataTable): boolean {
  let changed = false;
  for (const c of t.columns) {
    if (c.type !== 'numbering') continue;
    let max = (c.numbering?.start ?? 1) - 1;
    for (const e of t.entries) {
      const v = e.cells[c.id];
      if (typeof v === 'number' && v > max) max = v;
    }
    for (const e of t.entries) {
      if (typeof e.cells[c.id] === 'number') continue;
      e.cells[c.id] = ++max;
      changed = true;
    }
  }
  return changed;
}

/** Rough rendered width of a cell's text at 13px (CJK characters are about a full em). */
export function textWidth(s: string, padding = 18): number {
  let w = 0;
  for (const ch of s) w += /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(ch) ? 13.5 : 7.6;
  return Math.ceil(w + padding);
}

export interface ColFit {
  /** Width the column has on the canvas. */
  natural: number;
  /** Narrowest it may get (wrapping columns wrap below their natural width; others never wrap). */
  min: number;
  wrap: boolean;
}

/**
 * Column widths that fill `avail` pixels (Fill Window). Wrapping columns (text, files, labels)
 * take extra room or give it up first; the others shrink only to their content, never wrapping.
 * When even the minimums don't fit, the minimums are returned and the table scrolls.
 */
export function fitColumns(cols: ColFit[], avail: number): number[] {
  const w = cols.map((c) => Math.max(c.min, c.natural));
  const total = () => w.reduce((a, b) => a + b, 0);
  const grow = cols.map((c, i) => (c.wrap ? i : -1)).filter((i) => i >= 0);
  if (total() < avail) {
    const take = grow.length ? grow : cols.map((_, i) => i);
    const weight = take.reduce((s, i) => s + w[i], 0) || 1;
    const extra = avail - total();
    for (const i of take) w[i] += (extra * w[i]) / weight;
  } else {
    for (const group of [grow, cols.map((c, i) => (c.wrap ? -1 : i)).filter((i) => i >= 0)]) {
      const need = total() - avail;
      if (need <= 0) break;
      const room = group.reduce((s, i) => s + (w[i] - cols[i].min), 0);
      if (room <= 0) continue;
      const k = Math.min(1, need / room);
      for (const i of group) w[i] -= (w[i] - cols[i].min) * k;
    }
  }
  return w.map((x) => Math.floor(x));
}

export function columnWidth(c: Column): number {
  return c.width ?? (c.id === 'note' && c.type === 'text' ? 240 : TYPE_WIDTH[c.type]);
}

export const MIN_COL_W = 40;

/**
 * What a column's contents need (pixels at 13px, cell padding included):
 * `content` is the widest value on one line, `head` the header on one line and `head2` on two lines.
 */
export function measureColumn(col: Column, values: (CellData | undefined)[]): { content: number; head: number; head2: number } {
  const head = textWidth(col.name, 20);
  const head2 = Math.max(textWidth(col.name, 0) / 2 + 20, longestWord(col.name));
  let content = 0;
  const sample = values.length > 500 ? values.slice(0, 500) : values;
  for (const v of sample) {
    if (v === undefined) continue;
    let w = 0;
    if (col.type === 'checkbox') w = 34;
    else if (col.type === 'select') w = textWidth(String(v), 16 + 16 + 30); // chip padding, cell padding, menu button
    else if (col.type === 'files') {
      w = (Array.isArray(v) ? v : []).reduce((s, a) => s + Math.min(150, textWidth(a.name, 30)) + 4, 16);
    } else w = textWidth(cellDisplay(col, v));
    if (w > content) content = w;
  }
  if (col.type === 'checkbox') content = Math.max(content, 34);
  return { content: Math.ceil(content), head: Math.ceil(head), head2: Math.ceil(head2) };
}

/** Width of the longest unbreakable word (Latin words don't break; CJK breaks anywhere). */
function longestWord(s: string): number {
  return Math.max(0, ...s.split(/[\s\u2E80-\u9FFF]+/).filter(Boolean).map((w) => textWidth(w, 18)));
}

/** Fit Width to Content: the widest value or the header on one line, whichever is wider (text capped). */
export function bestFitWidth(col: Column, values: (CellData | undefined)[]): number {
  const m = measureColumn(col, values);
  const cap = col.type === 'text' || col.type === 'files' ? 320 : 480;
  return Math.max(MIN_COL_W, Math.min(cap, Math.max(m.content, m.head)));
}

/**
 * Fill Window: how each column may grow or shrink. Numbers, dates, numbering, checkboxes and pop-ups never
 * go below their content (their headers may take two lines); text and files give up width first, but not
 * past about three lines for their longest value.
 */
export function fillSpec(col: Column, values: (CellData | undefined)[]): ColFit {
  const m = measureColumn(col, values);
  const wrap = col.type === 'text' || col.type === 'files';
  const fitted = Math.max(MIN_COL_W, Math.min(wrap ? 320 : 480, Math.max(m.content, m.head)));
  const natural = col.width ?? fitted;
  if (!wrap) {
    const min = Math.max(MIN_COL_W, m.content, m.head2);
    return { natural: Math.max(natural, min), min, wrap: false };
  }
  const min = Math.min(natural, Math.max(80, m.head2, Math.ceil((m.content - 16) / 3) + 16));
  return { natural, min, wrap: true };
}

export function styleKey(rowId: string, colKey: string): string {
  return `${rowId}|${colKey}`;
}

export function bounds(rg: Range) {
  return {
    r0: Math.min(rg.a.r, rg.b.r),
    r1: Math.max(rg.a.r, rg.b.r),
    c0: Math.min(rg.a.c, rg.b.c),
    c1: Math.max(rg.a.c, rg.b.c),
  };
}

export function cellsInRanges(ranges: Range[]): Pos[] {
  const seen = new Set<string>();
  const out: Pos[] = [];
  for (const rg of ranges) {
    const { r0, r1, c0, c1 } = bounds(rg);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const k = `${r},${c}`;
        if (!seen.has(k)) {
          seen.add(k);
          out.push({ r, c });
        }
      }
    }
  }
  return out;
}

export function selectionStats(values: (string | number | null)[]) {
  const nums = values.filter((v): v is number => typeof v === 'number');
  const sum = nums.reduce((a, b) => a + b, 0);
  return { count: nums.length, sum, avg: nums.length ? sum / nums.length : 0 };
}

/**
 * What the editor needs to know about one table, whatever its kind.
 * `set`/`clear`/`insertBodyRow` mutate the table: call them inside app.change().
 */
export interface GridModel {
  rows: number;
  cols: number;
  /** Rows 0..body-1 are the table's own items (rows or entries); the rest are footers. */
  body: number;
  rowId(r: number): string;
  colKey(c: number): string;
  /** For copy, stats and display. Errors read as null. */
  value(p: Pos): string | number | null;
  /** Text to start the editor with. */
  raw(p: Pos): string;
  /** true, or a message explaining why the cell can't be edited. */
  editable(p: Pos): true | string;
  /** Returns false when the text isn't valid for the cell. */
  set(p: Pos, text: string): boolean;
  insertBodyRow(at: number): void;
  alignRight(c: number): boolean;
  /** What kind of cell this is, so editing can toggle checkboxes or open the files popover. */
  cellType(p: Pos): ColumnType | 'label' | 'calc';
  /** True when clearing the cell would change nothing. */
  isEmpty(p: Pos): boolean;
}

const num = (v: CellValue): number | null => (isErr(v) ? null : v);

export function cashflowModel(t: CashflowTable, months: MonthKey[], ev: Evaluator): GridModel {
  const nb = t.rows.length;
  const nf = FIXED_FOOTERS.length;
  const footerId = (r: number) => (r - nb < nf ? FIXED_FOOTERS[r - nb].id : t.footers[r - nb - nf].id);
  return {
    rows: nb + nf + t.footers.length,
    cols: months.length + 1,
    body: nb,
    rowId: (r) => (r < nb ? t.rows[r].id : footerId(r)),
    colKey: (c) => (c === 0 ? 'label' : months[c - 1]),
    value(p) {
      if (p.r < nb) {
        const row = t.rows[p.r];
        return p.c === 0 ? row.label : num(ev.row(t, row, months[p.c - 1]));
      }
      const f = p.r - nb;
      if (f < nf) {
        if (p.c === 0) return FIXED_FOOTERS[f].label;
        const m = months[p.c - 1];
        return num(f === 0 ? ev.cashFlow(t, m) : ev.balance(t, m));
      }
      const fr = t.footers[f - nf];
      return p.c === 0 ? fr.label : num(ev.footer(t, fr, months[p.c - 1]));
    },
    raw(p) {
      if (p.r >= nb) return p.c === 0 ? (t.footers[p.r - nb - nf]?.label ?? '') : '';
      const row = t.rows[p.r];
      if (p.c === 0) return row.label;
      const v = row.values[months[p.c - 1]];
      return v === undefined ? '' : String(v);
    },
    editable(p) {
      if (p.r < nb) {
        if (p.c > 0 && t.rows[p.r].formula !== undefined) {
          return 'This row is a formula. Edit the formula in the panel.';
        }
        return true;
      }
      if (p.r - nb < nf) return 'Net cash flow and Balance are calculated.';
      return p.c === 0 ? true : 'Footer rows are formulas. Edit the formula in the panel.';
    },
    set(p, text) {
      if (p.r >= nb) {
        const fr = t.footers[p.r - nb - nf];
        if (fr && p.c === 0) fr.label = text.trim();
        return true;
      }
      const row = t.rows[p.r];
      if (p.c === 0) {
        row.label = text.trim();
        return true;
      }
      if (row.formula !== undefined) return true;
      const n = parseNumber(text);
      if (n === undefined) return false;
      const m = months[p.c - 1];
      // Typing (or clearing) replaces a dataTable total shown in this cell.
      delete t.cellSources[`${row.id}|${m}`];
      // On a source row, clearing a cell goes back to the source's number.
      if (n === null) delete row.values[m];
      else row.values[m] = n;
      return true;
    },
    insertBodyRow: (at) => void t.rows.splice(at, 0, newRow()),
    alignRight: (c) => c > 0,
    cellType: (p) => (p.c === 0 ? 'label' : p.r < nb && t.rows[p.r].formula === undefined ? 'number' : 'calc'),
    isEmpty(p) {
      if (p.r >= nb) return p.c !== 0 || !(t.footers[p.r - nb - nf]?.label ?? '');
      const row = t.rows[p.r];
      if (p.c === 0) return row.label === '';
      const m = months[p.c - 1];
      return row.values[m] === undefined && !t.cellSources[`${row.id}|${m}`];
    },
  };
}

/**
 * A Table's grid. Rows are the visible rows (see visibleEntries): row r is `rows[r]`, and writes go to
 * that entry, so a filtered view edits the right rows. The Total row sums what is shown.
 */
export function dataTableModel(t: DataTable, now = new Date(), keep?: Set<string>): GridModel {
  const rows = visibleEntries(t, keep);
  const nb = rows.length;
  const filtered = rows.length !== t.entries.length;
  const cols = t.columns;
  const total = (c: Column): string | number => {
    if (c.type === 'number') {
      return rows.reduce((s, e) => {
        const v = e.cells[c.id];
        return typeof v === 'number' ? Math.round((s + v) * 100) / 100 : s;
      }, 0);
    }
    if (c.type === 'checkbox') return `${rows.filter((e) => e.cells[c.id] === true).length} ✓`;
    return '';
  };
  /** Where a new row goes in t.entries for view position `at`. */
  const realIndex = (at: number) => {
    if (at < nb) return t.entries.indexOf(rows[at]);
    return nb ? t.entries.indexOf(rows[nb - 1]) + 1 : t.entries.length;
  };
  return {
    rows: nb + 1,
    cols: cols.length,
    body: nb,
    rowId: (r) => (r < nb ? rows[r].id : '__total'),
    colKey: (c) => cols[c]?.id ?? '',
    value(p) {
      const col = cols[p.c];
      if (!col) return null;
      if (p.r >= nb) {
        const v = total(col);
        return p.c === 0 && v === '' ? (filtered ? `Total · ${nb} of ${t.entries.length}` : `Total · ${nb}`) : v;
      }
      return cellValue(col, rows[p.r].cells[col.id]);
    },
    raw(p) {
      const col = cols[p.c];
      const e = rows[p.r];
      return col && e ? cellRaw(col.type, e.cells[col.id]) : '';
    },
    editable(p) {
      if (p.r >= nb) return 'The total row is calculated.';
      if (cols[p.c]?.type === 'numbering') return 'Numbers are given out automatically.';
      return true;
    },
    set(p, text) {
      const col = cols[p.c];
      const e = rows[p.r];
      if (!col || !e || col.type === 'files' || col.type === 'numbering') return true;
      if (col.type === 'select') {
        if (!text.trim()) {
          delete e.cells[col.id];
          return true;
        }
        // A value not in the menu yet becomes a new choice (as when pasting a list).
        let label = optionFor(col, text);
        if (!label) {
          label = text.trim();
          col.options = [...(col.options ?? []), { id: uid(), label }];
        }
        e.cells[col.id] = label;
        return true;
      }
      const v = parseCell(col.type, text, now);
      if (v === undefined) return false;
      if (v === null) delete e.cells[col.id];
      else e.cells[col.id] = v;
      return true;
    },
    insertBodyRow: (at) => {
      const e = newEntryFor(t);
      keep?.add(e.id);
      t.entries.splice(realIndex(at), 0, e);
    },
    alignRight: (c) => cols[c]?.type === 'number',
    cellType: (p) => (p.r >= nb ? 'calc' : (cols[p.c]?.type ?? 'text')),
    isEmpty: (p) => p.r >= nb || !cols[p.c] || rows[p.r].cells[cols[p.c].id] === undefined,
  };
}

export function gridModel(t: Table, months: MonthKey[], ev: Evaluator, keep?: Set<string>): GridModel {
  return t.kind === 'table' ? dataTableModel(t, new Date(), keep) : cashflowModel(t, months, ev);
}
