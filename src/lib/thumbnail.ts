import { COL_W, LABEL_W, ROW_H, ROWTAB_W, TITLE_H, tableHeight, tableWidth } from './store.svelte';
import { columnWidth, FIXED_FOOTERS } from './grid';
import { visibleWindow } from './months';
import type { Table, Workbook } from './model';

/**
 * A file's icon picture, like Numbers' document thumbnails: the first sheet as a white page with its
 * tables drawn as shapes (header bands, grid lines and grey bars where cells hold something). No text
 * is drawn, so it stays legible at icon size and carries no file content into markup.
 */
export function thumbnailSVG(wb: Workbook): string {
  const sheet = wb.sheets[0];
  const months = visibleWindow().length;
  const tables = sheet?.tables ?? [];
  let maxX = 0;
  let maxY = 0;
  for (const t of tables) {
    maxX = Math.max(maxX, t.x + tableWidth(t, months));
    maxY = Math.max(maxY, t.y + tableHeight(t));
  }
  // A 4:3 page that shows at least the top-left 640 × 480 of the canvas (so tables read at icon size).
  let w = Math.max(640, maxX + 40);
  let h = w * 0.75;
  if (maxY + 40 > h) {
    h = maxY + 40;
    w = h / 0.75;
  }
  const parts = tables.map((t) => drawTable(t, months)).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.round(w)} ${Math.round(h)}" preserveAspectRatio="xMinYMin slice" aria-hidden="true"><rect width="100%" height="100%" fill="#fff"/>${parts}</svg>`;
}

const HEAD = '#f0f2f5';
const HEAD_COL = '#f6f7f9';
const LINE = '#d9dde3';
const INK = '#c3c8cf';
const MAX_ROWS = 60;

function drawTable(t: Table, months: number): string {
  const W = tableWidth(t, months);
  const H = tableHeight(t);
  const x0 = t.x;
  const y0 = t.y;
  const heads = t.kind === 'table' ? 1 : 2;
  const cols = t.kind === 'table' ? t.columns.map((c) => columnWidth(c)) : [LABEL_W, ...Array.from({ length: months }, () => COL_W)];
  const body = t.kind === 'table' ? t.entries.length + 1 : t.rows.length + FIXED_FOOTERS.length + t.footers.length;
  const rows = Math.min(body, MAX_ROWS);
  const gridTop = y0 + TITLE_H + heads * ROW_H;
  const out: string[] = [];
  out.push(`<rect x="${x0}" y="${y0}" width="${W}" height="${H}" rx="8" fill="#fff" stroke="${LINE}" stroke-width="2"/>`);
  // Title bar: a short dark bar for the name.
  out.push(`<rect x="${x0 + 14}" y="${y0 + 11}" width="${Math.min(160, W * 0.35)}" height="10" rx="5" fill="#9aa1aa"/>`);
  // Header rows, row tabs and the header column.
  out.push(`<rect x="${x0}" y="${y0 + TITLE_H}" width="${W}" height="${heads * ROW_H}" fill="${HEAD}"/>`);
  out.push(`<rect x="${x0}" y="${gridTop}" width="${ROWTAB_W}" height="${rows * ROW_H}" fill="${HEAD}"/>`);
  out.push(`<rect x="${x0 + ROWTAB_W}" y="${gridTop}" width="${cols[0] ?? 0}" height="${rows * ROW_H}" fill="${HEAD_COL}"/>`);
  // Grid lines.
  const lines: string[] = [];
  for (let r = 0; r <= rows + heads; r++) {
    const y = y0 + TITLE_H + r * ROW_H;
    lines.push(`M${x0} ${y}H${x0 + W}`);
  }
  let x = x0 + ROWTAB_W;
  lines.push(`M${x} ${y0 + TITLE_H}V${gridTop + rows * ROW_H}`);
  for (const cw of cols) {
    x += cw;
    lines.push(`M${x} ${y0 + TITLE_H}V${gridTop + rows * ROW_H}`);
  }
  out.push(`<path d="${lines.join('')}" stroke="${LINE}" stroke-width="1.5" fill="none"/>`);
  // Grey bars where cells hold something.
  const bars: string[] = [];
  const bar = (col: number, row: number, right: boolean) => {
    const cx = x0 + ROWTAB_W + cols.slice(0, col).reduce((a, b) => a + b, 0);
    const cw = cols[col];
    const bw = Math.min(cw * 0.6, 90);
    const bx = right ? cx + cw - 8 - bw : cx + 8;
    bars.push(`M${bx} ${gridTop + row * ROW_H + ROW_H / 2}h${bw}`);
  };
  if (t.kind === 'table') {
    t.entries.slice(0, MAX_ROWS - 1).forEach((e, r) => {
      t.columns.forEach((c, ci) => {
        if (e.cells[c.id] !== undefined && e.cells[c.id] !== false) bar(ci, r, c.type === 'number');
      });
    });
  } else {
    const keys = visibleWindow();
    t.rows.slice(0, MAX_ROWS).forEach((row, r) => {
      if (row.label) bar(0, r, false);
      keys.forEach((m, i) => {
        if (row.values[m] !== undefined || row.formula !== undefined || row.source) bar(i + 1, r, true);
      });
    });
  }
  if (bars.length) out.push(`<path d="${bars.join('')}" stroke="${INK}" stroke-width="8" stroke-linecap="round" fill="none"/>`);
  return out.join('');
}
