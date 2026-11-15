import { parseDate } from './dates';
import { formatNumber, parseNumber } from './format';
import type { Attachment, CellData, ColumnType, Condition, CondOp, Entry, Filter, Column, DataTable, Numbering } from './model';

export const COLUMN_TYPE_LABELS: Record<ColumnType, string> = {
  date: 'Date',
  number: 'Number',
  text: 'Text',
  checkbox: 'Checkbox',
  files: 'Files',
  numbering: 'Numbering',
  select: 'Pop-Up Menu',
};

// ---------- column formats ----------

const numberFormats = new Map<string, Intl.NumberFormat>();

/** A number shown with a column's format (decimals: null = automatic, up to 2; thousands separator on/off). */
export function formatWith(n: number, col?: Pick<Column, 'format'>): string {
  const f = col?.format;
  if (!f) return formatNumber(n);
  const key = `${f.decimals}|${f.thousands}`;
  let nf = numberFormats.get(key);
  if (!nf) {
    nf = new Intl.NumberFormat('en-US', {
      useGrouping: f.thousands,
      ...(f.decimals === null ? { maximumFractionDigits: 2 } : { minimumFractionDigits: f.decimals, maximumFractionDigits: f.decimals }),
    });
    numberFormats.set(key, nf);
  }
  return nf.format(Object.is(n, -0) ? 0 : n);
}

/** A Numbering column's text for row number `n`, e.g. "INV-0007". */
export function numberingText(nb: Numbering | undefined, n: number): string {
  if (!nb) return String(n);
  return nb.parts.map((p) => (p.kind === 'text' ? p.text : String(n).padStart(p.digits, '0'))).join('');
}

const TRUE_WORDS = new Set(['true', 'yes', 'y', '1', 'x', '✓', '✔', '☑', '是', '对', '已', 'checked']);
const FALSE_WORDS = new Set(['false', 'no', 'n', '0', '', '☐', '否', '不', 'unchecked']);

/** Checkbox text: true / false, or undefined when it's neither. */
export function parseBool(text: string): boolean | undefined {
  const t = text.trim().toLowerCase();
  if (TRUE_WORDS.has(t)) return true;
  if (FALSE_WORDS.has(t)) return false;
  return undefined;
}

/**
 * Parse typed or pasted text for a column. Returns null to clear the cell,
 * undefined when the text isn't valid for the column type.
 */
export function parseCell(type: ColumnType, text: string, now = new Date()): CellData | null | undefined {
  const t = text.trim();
  switch (type) {
    case 'date':
      if (!t) return null;
      return parseDate(t, 'mdy', now.getFullYear()) ?? undefined;
    case 'number': {
      const n = parseNumber(t);
      return n === undefined ? undefined : n;
    }
    case 'checkbox': {
      const b = parseBool(t);
      return b === undefined ? undefined : b ? true : null;
    }
    case 'files':
    case 'numbering':
      return undefined; // files come from the attachments popover; numbers are given out automatically
    default:
      return t === '' ? null : t;
  }
}

/** Raw value for copy and stats: numbers stay numbers. */
export function cellValue(col: Column, v: CellData | undefined): string | number | null {
  const type = col.type;
  if (v === undefined) return type === 'checkbox' ? 'FALSE' : null;
  if (type === 'checkbox') return v === true ? 'TRUE' : 'FALSE';
  if (type === 'files') return (v as Attachment[]).map((a) => a.name).join(', ');
  if (type === 'numbering') return numberingText(col.numbering, v as number);
  return v as string | number;
}

/** Text shown in the grid. */
export function cellDisplay(col: Column, v: CellData | undefined): string {
  if (v === undefined) return '';
  if (col.type === 'number') return formatWith(v as number, col);
  if (col.type === 'numbering') return numberingText(col.numbering, v as number);
  if (col.type === 'files') return (v as Attachment[]).map((a) => a.name).join(', ');
  if (col.type === 'checkbox') return '';
  return String(v);
}

/** The option label matching typed or pasted text (any letter case), if there is one. */
export function optionFor(col: Column, text: string): string | undefined {
  const t = text.trim().toLowerCase();
  return col.options?.find((o) => o.label.trim().toLowerCase() === t)?.label;
}

// ---------- conditions (row filters and conditional highlighting) ----------

/** The tests offered for a column type, with their menu labels. */
export function condOps(type: ColumnType): { op: CondOp; label: string }[] {
  const empty = [
    { op: 'empty' as const, label: 'is empty' },
    { op: 'notEmpty' as const, label: 'is not empty' },
  ];
  switch (type) {
    case 'number':
      return [
        { op: 'eq', label: '=' }, { op: 'ne', label: '≠' }, { op: 'gt', label: '>' }, { op: 'ge', label: '≥' },
        { op: 'lt', label: '<' }, { op: 'le', label: '≤' }, { op: 'between', label: 'is between' }, ...empty,
      ];
    case 'date':
      return [{ op: 'on', label: 'is on' }, { op: 'before', label: 'is before' }, { op: 'after', label: 'is after' }, { op: 'between', label: 'is between' }, ...empty];
    case 'checkbox':
      return [{ op: 'checked', label: 'is checked' }, { op: 'unchecked', label: 'is not checked' }];
    case 'select':
      return [{ op: 'is', label: 'is' }, { op: 'isNot', label: 'is not' }, ...empty];
    default:
      return [
        { op: 'contains', label: 'contains' }, { op: 'notContains', label: 'does not contain' }, { op: 'is', label: 'is' },
        { op: 'isNot', label: 'is not' }, { op: 'begins', label: 'starts with' }, { op: 'ends', label: 'ends with' }, ...empty,
      ];
  }
}

/** Tests that need no value. */
export const NO_VALUE_OPS: CondOp[] = ['checked', 'unchecked', 'empty', 'notEmpty'];

/** Does an entry pass a condition? Conditions on a missing column, or still without a value, pass. */
export function matchCond(e: Entry, cols: Column[], c: Condition): boolean {
  const col = cols.find((x) => x.id === c.col);
  if (!col) return true;
  const v = e.cells[col.id];
  const isEmpty = v === undefined || (Array.isArray(v) && !v.length);
  if (c.op === 'empty') return isEmpty;
  if (c.op === 'notEmpty') return !isEmpty;
  if (c.op === 'checked') return v === true;
  if (c.op === 'unchecked') return v !== true;
  if (!c.value.trim() && !(c.op === 'between' && c.value2.trim())) return true;
  if (col.type === 'number') {
    const n = typeof v === 'number' ? v : null;
    const a = parseNumber(c.value);
    const b = parseNumber(c.value2);
    if (n === null) return c.op === 'ne';
    if (typeof a !== 'number' && c.op !== 'between') return true;
    const x = a as number;
    switch (c.op) {
      case 'eq': return n === x;
      case 'ne': return n !== x;
      case 'gt': return n > x;
      case 'ge': return n >= x;
      case 'lt': return n < x;
      case 'le': return n <= x;
      case 'between': return (typeof a !== 'number' || n >= a) && (typeof b !== 'number' || n <= b);
      default: return true;
    }
  }
  if (col.type === 'date') {
    const d = typeof v === 'string' ? v : '';
    const a = parseDate(c.value.trim(), 'mdy', new Date().getFullYear()) ?? '';
    const b = parseDate(c.value2.trim(), 'mdy', new Date().getFullYear()) ?? '';
    if (!d) return false;
    switch (c.op) {
      case 'on': return !a || d === a;
      case 'before': return !a || d < a;
      case 'after': return !a || d > a;
      case 'between': return (!a || d >= a) && (!b || d <= b);
      default: return true;
    }
  }
  const text = norm(cellDisplay(col, v));
  const q = norm(c.value);
  switch (c.op) {
    case 'contains': return text.includes(q);
    case 'notContains': return !text.includes(q);
    case 'is': return text === q;
    case 'isNot': return text !== q;
    case 'begins': return text.startsWith(q);
    case 'ends': return text.endsWith(q);
    default: return true;
  }
}

/** Text to start the cell editor with. */
export function cellRaw(type: ColumnType, v: CellData | undefined): string {
  if (v === undefined || type === 'files' || type === 'checkbox') return '';
  return String(v);
}

/** Convert a value when a column changes type; undefined = can't keep it. */
export function convertCell(from: Column, to: ColumnType, v: CellData): CellData | undefined {
  if (from.type === to) return v;
  if (to === 'files' || from.type === 'files' || to === 'numbering') return undefined;
  const text = from.type === 'checkbox' ? (v ? 'true' : '') : from.type === 'numbering' ? numberingText(from.numbering, v as number) : String(v);
  const out = parseCell(to, text);
  return out === null ? undefined : out;
}

export function firstColumnOf(l: DataTable, type: ColumnType): Column | undefined {
  return l.columns.find((c) => c.type === type);
}

const norm = (s: string) => s.trim().toLowerCase();

export function matchesFilters(e: Entry, filters: Filter[]): boolean {
  for (const f of filters) {
    const v = e.cells[f.col];
    if (f.op === 'checked' && v !== true) return false;
    if (f.op === 'unchecked' && v === true) return false;
    if (f.op === 'in' && f.values.length) {
      const set = new Set(f.values.map(norm));
      if (!set.has(norm(typeof v === 'string' || typeof v === 'number' ? String(v) : ''))) return false;
    }
    if (f.op === 'contains' && f.text.trim()) {
      const text = Array.isArray(v) ? v.map((a) => a.name).join(' ') : v === undefined ? '' : String(v);
      if (!text.toLowerCase().includes(norm(f.text))) return false;
    }
  }
  return true;
}

/** Distinct values of a text column, most used first. */
export function distinctValues(l: DataTable, colId: string): { name: string; count: number }[] {
  const counts = new Map<string, { name: string; count: number }>();
  for (const e of l.entries) {
    const v = e.cells[colId];
    if (typeof v !== 'string' || !v.trim()) continue;
    const k = norm(v);
    const hit = counts.get(k);
    if (hit) hit.count++;
    else counts.set(k, { name: v.trim(), count: 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** A dataTable column id that isn't taken yet. */
export function newColumnId(l: DataTable): string {
  let i = l.columns.length + 1;
  while (l.columns.some((c) => c.id === `c${i}`)) i++;
  return `c${i}`;
}
