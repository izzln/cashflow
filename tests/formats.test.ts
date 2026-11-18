import { describe, expect, it } from 'vitest';
import { formatWith, matchCond, numberingText, optionFor } from '../src/lib/columns';
import { assignNumbers, bestFitWidth, dataTableModel, fillSpec, visibleEntries } from '../src/lib/grid';
import { newDataTable, normalizeWorkbook, type Condition, type DataTable } from '../src/lib/model';

const cond = (col: string, op: Condition['op'], value = '', value2 = ''): Condition => ({ id: 'k', col, op, value, value2 });

function table(): DataTable {
  const t = newDataTable('T');
  t.columns.push({ id: 'no', name: 'No.', type: 'numbering', numbering: { parts: [{ id: 'a', kind: 'text', text: 'INV-' }, { id: 'b', kind: 'seq', digits: 4 }], start: 1 } });
  t.columns.push({ id: 'st', name: 'Status', type: 'select', options: [{ id: 'o1', label: 'Paid' }, { id: 'o2', label: 'Open' }], defaultOption: 'o2' });
  t.entries[0].cells = { date: '2026-11-03', amount: -120, category: 'Rent', st: 'Paid' };
  t.entries[1].cells = { date: '2026-11-20', amount: 300, category: 'Sales', st: 'Open' };
  t.entries[2].cells = { amount: 0 };
  return t;
}

describe('column formats', () => {
  it('formats numbers by column', () => {
    expect(formatWith(-1234.5)).toBe('-1,234.5');
    expect(formatWith(-1234.5, { format: { decimals: 2, thousands: true } })).toBe('-1,234.50');
    expect(formatWith(1234.567, { format: { decimals: 0, thousands: false } })).toBe('1235');
    expect(formatWith(1234.567, { format: { decimals: null, thousands: false } })).toBe('1234.57');
  });

  it('builds numbering text and numbers rows once, in order', () => {
    const t = table();
    expect(numberingText(t.columns[4].numbering, 7)).toBe('INV-0007');
    expect(assignNumbers(t)).toBe(true);
    expect(t.entries.map((e) => e.cells.no)).toEqual([1, 2, 3]);
    // Deleting a row never renumbers; a new row gets the next number.
    t.entries.splice(1, 1);
    t.entries.push({ id: 'new', cells: {} });
    assignNumbers(t);
    expect(t.entries.map((e) => e.cells.no)).toEqual([1, 3, 4]);
    const m = dataTableModel(t);
    expect(m.value({ r: 2, c: 4 })).toBe('INV-0004');
    expect(m.editable({ r: 0, c: 4 })).not.toBe(true);
  });

  it('pop-up menus match choices and add new ones; new rows take the default', () => {
    const t = table();
    expect(optionFor(t.columns[5], ' paid ')).toBe('Paid');
    const m = dataTableModel(t);
    expect(m.set({ r: 2, c: 5 }, 'Overdue')).toBe(true);
    expect(t.columns[5].options?.map((o) => o.label)).toEqual(['Paid', 'Open', 'Overdue']);
    m.insertBodyRow(3);
    expect(t.entries[3].cells.st).toBe('Open');
  });
});

describe('conditions', () => {
  it('tests numbers, dates, text, choices and emptiness', () => {
    const t = table();
    const [a, b, c] = t.entries;
    expect(matchCond(a, t.columns, cond('amount', 'lt', '0'))).toBe(true);
    expect(matchCond(b, t.columns, cond('amount', 'between', '100', '500'))).toBe(true);
    expect(matchCond(a, t.columns, cond('date', 'before', '2026-11-10'))).toBe(true);
    expect(matchCond(c, t.columns, cond('date', 'empty'))).toBe(true);
    expect(matchCond(a, t.columns, cond('category', 'contains', 'REN'))).toBe(true);
    expect(matchCond(b, t.columns, cond('st', 'isNot', 'Paid'))).toBe(true);
    // A rule still without a value lets every row through.
    expect(matchCond(a, t.columns, cond('category', 'is', ''))).toBe(true);
  });

  it('filters the rows a Table shows, and its model edits the right rows', () => {
    const t = table();
    t.filter = { on: true, any: false, rules: [cond('amount', 'ge', '0')] };
    expect(visibleEntries(t).map((e) => e.cells.amount)).toEqual([300, 0]);
    const m = dataTableModel(t);
    expect(m.body).toBe(2);
    expect(m.value({ r: 2, c: 0 })).toBe('Total · 2 of 3');
    m.set({ r: 0, c: 2 }, 'Sales EU');
    expect(t.entries[1].cells.category).toBe('Sales EU');
    t.filter.any = true;
    t.filter.rules.push(cond('category', 'is', 'Rent'));
    expect(visibleEntries(t)).toHaveLength(3);
    t.filter.on = false;
    expect(visibleEntries(t)).toHaveLength(3);
  });

  it('loads highlights and filters from saved JSON', () => {
    const wb = normalizeWorkbook({
      schema: 1,
      sheets: [{ id: 's', name: 'S', tables: [{ kind: 'table', id: 't', name: 'T', columns: [{ id: 'amount', name: 'A', type: 'number' }], entries: [],
        highlights: [{ id: 'h', cond: { col: 'amount', op: 'lt', value: '0' }, target: 'row', style: 'red' }, { bad: true }],
        filter: { on: true, rules: [{ col: 'amount', op: 'nope', value: '1' }] } }] }],
    });
    const t = wb!.sheets[0].tables[0] as DataTable;
    expect(t.highlights).toHaveLength(1);
    expect(t.highlights[0].target).toBe('row');
    expect(t.filter.on).toBe(true);
    expect(t.filter.rules[0].op).toBe('contains');
  });
});

describe('column widths', () => {
  it('fits columns to what they hold', () => {
    const check = { id: 'k', name: '已支出', type: 'checkbox' as const };
    const no = { id: 'n', name: '日志编号', type: 'numbering' as const, numbering: { parts: [{ id: 'a', kind: 'text' as const, text: 'F' }, { id: 'b', kind: 'seq' as const, digits: 4 }], start: 1 } };
    const pop = { id: 'p', name: '支出银行', type: 'select' as const, options: [{ id: 'o', label: 'Z/中国建设银行' }] };
    const note = { id: 't', name: 'Note', type: 'text' as const };
    // Narrow columns stay narrow: about their header, not a fixed type width.
    expect(bestFitWidth(check, [true, undefined])).toBeLessThan(70);
    expect(bestFitWidth(no, [17, 16])).toBeLessThan(80);
    // A pop-up fits its longest choice plus its menu button.
    expect(bestFitWidth(pop, ['Z/中国建设银行'])).toBeGreaterThan(140);
    // Text: Fill Window may shrink it, but not past about three lines of its longest value.
    const long = 'x'.repeat(120);
    const spec = fillSpec(note, [long]);
    expect(spec.wrap).toBe(true);
    expect(spec.min * 3).toBeGreaterThanOrEqual(120 * 7.6);
    // Numbers never shrink below their content.
    const amount = { id: 'a', name: 'Amount', type: 'number' as const };
    const s2 = fillSpec(amount, [-91480]);
    expect(s2.wrap).toBe(false);
    expect(s2.min).toBeGreaterThanOrEqual(s2.natural - 1);
  });
});
