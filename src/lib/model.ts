import { currentMonth, isMonthKey, type MonthKey } from './months';

/** Only dataTable entries that pass every filter count. */
export interface Filter {
  /** Column id in the source table. */
  col: string;
  /** in: the cell equals one of `values` (text columns); contains: includes `text`; checked/unchecked: checkbox columns. */
  op: 'in' | 'contains' | 'checked' | 'unchecked';
  values: string[];
  text: string;
}

/** A whole cash-flow row from a dataTable: each month = sum of the amount column for entries dated in that month. */
export interface RowSource {
  tableId: string;
  dateCol: string;
  amountCol: string;
  filters: Filter[];
  /** Multiply by −1 (e.g. a dataTable that records payments as positive numbers). */
  flip: boolean;
}

/** One cash-flow cell from a dataTable: the total of one number column over the matching entries (any date). */
export interface CellSource {
  tableId: string;
  col: string;
  filters: Filter[];
  flip: boolean;
}

export interface Row {
  id: string;
  label: string;
  /**
   * Manual amounts per month (inflows positive, outflows negative).
   * On a source row these are overrides of the source's number.
   */
  values: Record<MonthKey, number>;
  /** If set, the row's numbers come from a dataTable. */
  source?: RowSource;
  /** If set, the row is computed by this formula, e.g. `[Sales] * 6%`. */
  formula?: string;
}

/** A computed row shown below Balance; it does not count toward net cash flow. */
export interface FooterRow {
  id: string;
  label: string;
  formula: string;
}

interface TableBase {
  id: string;
  name: string;
  /** Position on the sheet canvas, in pixels (snapped to the grid). */
  x: number;
  y: number;
  /** Style preset per cell, keyed by `${rowId}|${colKey}`. */
  styles: Record<string, string>;
  /** Text alignment per cell (text, date and row-label cells only), same keys as styles. */
  aligns: Record<string, Align>;
}

/** A month-by-month cash-flow table. */
export interface CashflowTable extends TableBase {
  kind: 'cashflow';
  /** Cells that show a dataTable column total, keyed by `${rowId}|${month}`. */
  cellSources: Record<string, CellSource>;
  /** Balance at the start of openingMonth, before that month's cash flow. */
  openingBalance: number;
  openingMonth: MonthKey;
  rows: Row[];
  footers: FooterRow[];
}

export type ColumnType = 'date' | 'number' | 'text' | 'checkbox' | 'files' | 'numbering' | 'select';

/** Number columns: decimals (null = automatic, up to 2) and the thousands separator. */
export interface NumberFormat {
  decimals: number | null;
  thousands: boolean;
}

/** One piece of a Numbering column's pattern: fixed text, or the row's number padded to `digits`. */
export type NumberingPart = { id: string; kind: 'text'; text: string } | { id: string; kind: 'seq'; digits: number };

/** Numbering columns: each row gets the next number when it is created and keeps it (like Feishu auto-numbers). */
export interface Numbering {
  parts: NumberingPart[];
  /** The first number given out. */
  start: number;
}

export interface SelectOption {
  id: string;
  label: string;
}

export interface Column {
  id: string;
  name: string;
  type: ColumnType;
  /** number */
  format?: NumberFormat;
  /** numbering */
  numbering?: Numbering;
  /** select (pop-up menu): the choices, in menu order; cells store the chosen label. */
  options?: SelectOption[];
  /** select: option id that new rows start with (none = blank). */
  defaultOption?: string | null;
}

/** A test on one column, used by row filters and conditional highlighting. */
export type CondOp =
  | 'eq' | 'ne' | 'gt' | 'ge' | 'lt' | 'le' | 'between'
  | 'contains' | 'notContains' | 'is' | 'isNot' | 'begins' | 'ends'
  | 'before' | 'after' | 'on'
  | 'checked' | 'unchecked' | 'empty' | 'notEmpty';

export interface Condition {
  id: string;
  col: string;
  op: CondOp;
  value: string;
  /** Upper end for 'between'. */
  value2: string;
}

/** Conditional highlighting: a tint applied to the cell (in the condition's column) or to the whole row. */
export interface Highlight {
  id: string;
  cond: Condition;
  target: 'cell' | 'row';
  /** Tint preset id (see styles.ts). */
  style: string;
}

/** Row filter: only rows matching all (or any) rules are shown while it is on. */
export interface RowFilter {
  on: boolean;
  any: boolean;
  rules: Condition[];
}

/** A file attached to a dataTable cell; the bytes are stored separately (see attachments). */
export interface Attachment {
  id: string;
  name: string;
  size: number;
  type: string;
}

/** date: 'YYYY-MM-DD'; number; text; checkbox: boolean; files: list. A missing key is an empty cell. */
export type CellData = string | number | boolean | Attachment[];

/** One row of a dataTable. */
export interface Entry {
  id: string;
  cells: Record<string, CellData>;
}

/** How a CSV/Excel file maps onto dataTable columns; saved so re-imports are one step. */
export interface ImportMap {
  hasHeader: boolean;
  sheet: string;
  /** Table column id → file column (a header name when hasHeader, else a 0-based index as text). */
  cols: Record<string, string>;
  /** Fill one number column from separate money-in and money-out file columns (in − out). */
  split: { col: string; income: string; expense: string } | null;
  /** Multiply imported numbers by −1. */
  flip: boolean;
}

/** A list of dated amounts (entered by hand or imported) that cash-flow rows can draw on. */
export interface DataTable extends TableBase {
  kind: 'table';
  columns: Column[];
  entries: Entry[];
  importMap?: ImportMap;
  /** Name of the last imported file, for the "re-import" hint. */
  importedFrom?: string;
  /** Conditional highlighting rules, in order: the first match wins. */
  highlights: Highlight[];
  filter: RowFilter;
}

export type Table = CashflowTable | DataTable;

export interface Sheet {
  id: string;
  name: string;
  tables: Table[];
}

export interface FileSettings {
  /** How often an open file syncs its remote sources. */
  syncMinutes: number;
}

export interface Workbook {
  schema: 1;
  sheets: Sheet[];
  settings: FileSettings;
}

export type Align = 'left' | 'center' | 'right';

export const GRID = 20;
export const DEFAULT_SETTINGS: FileSettings = { syncMinutes: 15 };

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function newRow(label = ''): Row {
  return { id: uid(), label, values: {} };
}

export function newEntry(): Entry {
  return { id: uid(), cells: {} };
}

/** The columns a new dataTable starts with. Fixed ids keep imports and sources simple. */
export function defaultColumns(): Column[] {
  return [
    { id: 'date', name: 'Date', type: 'date' },
    { id: 'amount', name: 'Amount', type: 'number' },
    { id: 'category', name: 'Category', type: 'text' },
    { id: 'note', name: 'Note', type: 'text' },
  ];
}

export function newCashflow(name: string, x = GRID * 2, y = GRID * 2): CashflowTable {
  return {
    kind: 'cashflow',
    id: uid(),
    name,
    x,
    y,
    openingBalance: 0,
    openingMonth: currentMonth(),
    rows: ['', '', '', ''].map(() => newRow()),
    footers: [],
    cellSources: {},
    styles: {},
    aligns: {},
  };
}

export function newDataTable(name: string, x = GRID * 2, y = GRID * 2): DataTable {
  return {
    kind: 'table',
    id: uid(),
    name,
    x,
    y,
    columns: defaultColumns(),
    entries: [0, 1, 2].map(() => newEntry()),
    styles: {},
    aligns: {},
    highlights: [],
    filter: { on: false, any: false, rules: [] },
  };
}

export function newSheet(name: string): Sheet {
  return { id: uid(), name, tables: [newCashflow('Cashflow 1')] };
}

export function starterWorkbook(): Workbook {
  const t = newCashflow('Main account');
  t.rows = ['Sales receipts', 'Payroll', 'Rent', 'Suppliers', 'Taxes'].map((l) => newRow(l));
  return {
    schema: 1,
    sheets: [{ id: uid(), name: 'Operating', tables: [t] }],
    settings: { ...DEFAULT_SETTINGS },
  };
}

/** Items in a table's body, in order: cash-flow rows or dataTable entries. */
export function bodyItems(t: Table): { id: string }[] {
  return t.kind === 'table' ? t.entries : t.rows;
}

// ---------- loading ----------

const str = (v: unknown, d = '') => (typeof v === 'string' ? v : v == null ? d : String(v));
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

function normStyles(v: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries((v as object) ?? {}).filter(([, s]) => typeof s === 'string'),
  ) as Record<string, string>;
}

function normFilters(v: unknown): Filter[] {
  return arr(v)
    .filter((f) => f && typeof f.col === 'string')
    .map((f) => ({
      col: f.col,
      op: ['in', 'contains', 'checked', 'unchecked'].includes(f.op) ? f.op : 'in',
      values: arr(f.values).map((x) => str(x)),
      text: str(f.text),
    }));
}

function normSource(s: any): RowSource | undefined {
  if (!s || typeof s !== 'object' || typeof s.tableId !== 'string') return undefined;
  const filters = normFilters(s.filters);
  return {
    tableId: s.tableId,
    dateCol: str(s.dateCol, 'date') || 'date',
    amountCol: str(s.amountCol, 'amount') || 'amount',
    filters,
    flip: !!s.flip,
  };
}

function normCellSource(s: any): CellSource | undefined {
  if (!s || typeof s !== 'object' || typeof s.tableId !== 'string') return undefined;
  return { tableId: s.tableId, col: str(s.col, 'amount') || 'amount', filters: normFilters(s.filters), flip: !!s.flip };
}

function normRow(r: any): Row {
  const row: Row = {
    id: str(r?.id) || uid(),
    label: str(r?.label),
    values: Object.fromEntries(
      Object.entries(r?.values ?? {}).filter(
        ([k, v]) => isMonthKey(k) && typeof v === 'number' && Number.isFinite(v),
      ),
    ) as Record<string, number>,
  };
  const source = normSource(r?.source);
  if (source) row.source = source;
  if (typeof r?.formula === 'string') row.formula = r.formula;
  return row;
}

function normImportMap(m: any): ImportMap | undefined {
  if (!m || typeof m !== 'object') return undefined;
  const cols: Record<string, string> = {};
  let split: ImportMap['split'] = null;
  for (const [k, v] of Object.entries(m.cols ?? {})) if (typeof v === 'string' && v) cols[k] = v;
  if (m.split && typeof m.split.col === 'string') {
    split = { col: m.split.col, income: str(m.split.income), expense: str(m.split.expense) };
  }
  return { hasHeader: m.hasHeader !== false, sheet: str(m.sheet), cols, split, flip: !!m.flip };
}

const COLUMN_TYPES = ['date', 'number', 'text', 'checkbox', 'files', 'numbering', 'select'];
const COND_OPS = ['eq', 'ne', 'gt', 'ge', 'lt', 'le', 'between', 'contains', 'notContains', 'is', 'isNot', 'begins', 'ends',
  'before', 'after', 'on', 'checked', 'unchecked', 'empty', 'notEmpty'];

/** Fresh numbering settings: "1", "2", … (one number part, no padding). */
export function defaultNumbering(): Numbering {
  return { parts: [{ id: uid(), kind: 'seq', digits: 1 }], start: 1 };
}

function normColumn(c: any): Column {
  const type = (COLUMN_TYPES.includes(c.type) ? c.type : 'text') as ColumnType;
  const col: Column = { id: c.id, name: str(c.name), type };
  if (c.format && typeof c.format === 'object') {
    const d = c.format.decimals;
    col.format = { decimals: typeof d === 'number' && d >= 0 && d <= 6 ? Math.round(d) : null, thousands: c.format.thousands !== false };
  }
  if (c.numbering && typeof c.numbering === 'object') {
    const parts = arr(c.numbering.parts)
      .map((p): NumberingPart | null =>
        p?.kind === 'text'
          ? { id: str(p.id) || uid(), kind: 'text', text: str(p.text) }
          : p?.kind === 'seq'
            ? { id: str(p.id) || uid(), kind: 'seq', digits: Math.max(1, Math.min(10, Math.round(num(p.digits)) || 1)) }
            : null,
      )
      .filter((p): p is NumberingPart => !!p);
    col.numbering = { parts: parts.length ? parts : defaultNumbering().parts, start: Math.round(num(c.numbering.start ?? 1)) };
  } else if (type === 'numbering') col.numbering = defaultNumbering();
  if (Array.isArray(c.options)) {
    const seen = new Set<string>();
    col.options = arr(c.options)
      .filter((o) => o && typeof o.label === 'string' && !seen.has(o.label) && seen.add(o.label))
      .map((o) => ({ id: str(o.id) || uid(), label: o.label }));
    if (typeof c.defaultOption === 'string' && col.options.some((o) => o.id === c.defaultOption)) col.defaultOption = c.defaultOption;
  } else if (type === 'select') col.options = [];
  return col;
}

function normColumns(v: unknown): Column[] {
  const seen = new Set<string>();
  const cols = arr(v)
    .filter((c) => c && typeof c.id === 'string' && !seen.has(c.id) && seen.add(c.id))
    .map(normColumn);
  return cols.length ? cols : defaultColumns();
}

function normCond(c: any): Condition | null {
  if (!c || typeof c.col !== 'string') return null;
  return { id: str(c.id) || uid(), col: c.col, op: COND_OPS.includes(c.op) ? c.op : 'contains', value: str(c.value), value2: str(c.value2) };
}

function normCell(type: ColumnType, v: unknown): CellData | undefined {
  switch (type) {
    case 'date':
      return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
    case 'number':
    case 'numbering':
      return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
    case 'checkbox':
      return v === true ? true : undefined;
    case 'files':
      return Array.isArray(v) && v.length
        ? v
            .filter((a) => a && typeof a.id === 'string')
            .map((a) => ({ id: a.id, name: str(a.name, 'file'), size: num(a.size), type: str(a.type) }))
        : undefined;
    default:
      return typeof v === 'string' && v !== '' ? v : undefined;
  }
}

function normEntry(e: any, columns: Column[]): Entry {
  const raw = e?.cells && typeof e.cells === 'object' ? e.cells : {};
  const cells: Record<string, CellData> = {};
  for (const c of columns) {
    const v = normCell(c.type, raw[c.id]);
    if (v !== undefined) cells[c.id] = v;
  }
  return { id: str(e?.id) || uid(), cells };
}

function normTable(t: any): Table {
  const base = {
    id: str(t?.id) || uid(),
    name: str(t?.name, 'Table'),
    x: num(t?.x),
    y: num(t?.y),
    styles: normStyles(t?.styles),
    aligns: Object.fromEntries(
      Object.entries((t?.aligns as object) ?? {}).filter(([, v]) => v === 'left' || v === 'center' || v === 'right'),
    ) as Record<string, Align>,
  };
  if (t?.kind === 'table') {
    const columns = normColumns(t.columns);
    const l: DataTable = {
      ...base,
      kind: 'table',
      columns,
      entries: arr(t.entries).map((e) => normEntry(e, columns)),
      highlights: arr(t.highlights)
        .map((h) => {
          const cond = normCond(h?.cond);
          return cond
            ? { id: str(h.id) || uid(), cond, target: h.target === 'row' ? ('row' as const) : ('cell' as const), style: str(h.style, 'yellow') }
            : null;
        })
        .filter((h): h is Highlight => !!h),
      filter: {
        on: !!t.filter?.on,
        any: !!t.filter?.any,
        rules: arr(t.filter?.rules).map(normCond).filter((c): c is Condition => !!c),
      },
    };
    const im = normImportMap(t.importMap);
    if (im) l.importMap = im;
    if (typeof t.importedFrom === 'string') l.importedFrom = t.importedFrom;
    return l;
  }
  return {
    ...base,
    kind: 'cashflow',
    openingBalance: num(t?.openingBalance),
    openingMonth: isMonthKey(t?.openingMonth) ? t.openingMonth : currentMonth(),
    rows: arr(t?.rows).map(normRow),
    footers: arr(t?.footers).map((f) => ({
      id: str(f?.id) || uid(),
      label: str(f?.label),
      formula: str(f?.formula),
    })),
    cellSources: Object.fromEntries(
      Object.entries((t?.cellSources as object) ?? {})
        .map(([k, v]) => [k, normCellSource(v)] as const)
        .filter(([k, v]) => /^[^|]+\|\d{4}-\d{2}$/.test(k) && v),
    ) as Record<string, CellSource>,
  };
}

/** Accept a parsed JSON value only if it looks like a workbook; fill missing fields. */
export function normalizeWorkbook(raw: unknown): Workbook | null {
  if (!raw || typeof raw !== 'object') return null;
  const wb = raw as any;
  if (!Array.isArray(wb.sheets) || wb.sheets.length === 0) return null;
  const minutes = Number(wb.settings?.syncMinutes);
  return {
    schema: 1,
    sheets: wb.sheets.map((s: any) => ({
      id: str(s?.id) || uid(),
      name: str(s?.name, 'Sheet'),
      tables: arr(s?.tables).map(normTable),
    })),
    settings: {
      syncMinutes: Number.isFinite(minutes) && minutes >= 1 ? Math.round(minutes) : DEFAULT_SETTINGS.syncMinutes,
    },
  };
}
