<script lang="ts">
  import { app } from '../lib/store.svelte';
  import { formatWith, numberingText } from '../lib/columns';
  import { uid, type Column, type DataTable, type Numbering, type NumberingPart, type SelectOption } from '../lib/model';
  import ReorderList from './ReorderList.svelte';
  import Icon from './Icon.svelte';

  /** Settings for a column's format: Number options, Numbering rules, Pop-Up Menu choices. */
  let { table, col, ro }: { table: DataTable; col: Column; ro: boolean } = $props();

  const val = (e: Event) => (e.currentTarget as HTMLInputElement | HTMLSelectElement).value;

  // ----- Number -----
  const fmt = $derived(col.format ?? { decimals: null, thousands: true });

  // ----- Numbering -----
  const nb = $derived<Numbering>(col.numbering ?? { parts: [], start: 1 });
  function setNumbering(next: Numbering) {
    app.setNumbering(table.id, col.id, next);
  }
  function setPart(i: number, part: NumberingPart) {
    setNumbering({ ...nb, parts: nb.parts.map((p, k) => (k === i ? part : p)) });
  }
  function movePart(from: number, to: number) {
    const parts = [...nb.parts];
    const [p] = parts.splice(from, 1);
    parts.splice(to, 0, p);
    setNumbering({ ...nb, parts });
  }
  const preview = $derived([0, 1, 2].map((k) => numberingText(nb, nb.start + k)).join(', ') + ', …');

  // ----- Pop-Up Menu -----
  const options = $derived<SelectOption[]>(col.options ?? []);
  const used = $derived.by(() => {
    app.version;
    const n = new Map<string, number>();
    for (const e of table.entries) {
      const v = e.cells[col.id];
      if (typeof v === 'string') n.set(v, (n.get(v) ?? 0) + 1);
    }
    return n;
  });
  function setOptions(next: SelectOption[]) {
    app.setOptions(table.id, col.id, next);
  }
  function renameOption(id: string, label: string) {
    const l = label.trim();
    if (!l || options.some((o) => o.id !== id && o.label === l)) return;
    setOptions(options.map((o) => (o.id === id ? { ...o, label: l } : o)));
  }
  function addOption() {
    let n = options.length + 1;
    while (options.some((o) => o.label === `Choice ${n}`)) n++;
    setOptions([...options, { id: uid(), label: `Choice ${n}` }]);
  }
  function moveOption(from: number, to: number) {
    const next = [...options];
    const [o] = next.splice(from, 1);
    next.splice(to, 0, o);
    setOptions(next);
  }
</script>

{#if col.type === 'number'}
  <label>Decimals
    <select value={fmt.decimals === null ? 'auto' : String(fmt.decimals)} disabled={ro}
      onchange={(e) => app.setNumberFormat(table.id, col.id, { ...fmt, decimals: val(e) === 'auto' ? null : Number(val(e)) })}>
      <option value="auto">Auto (up to 2)</option>
      {#each [0, 1, 2, 3, 4, 5, 6] as d (d)}<option value={String(d)}>{d}</option>{/each}
    </select>
  </label>
  <label class="check">
    <input type="checkbox" checked={fmt.thousands} disabled={ro}
      onchange={(e) => app.setNumberFormat(table.id, col.id, { ...fmt, thousands: (e.currentTarget as HTMLInputElement).checked })} />
    Thousands separator
  </label>
  <p class="hint">Shows as <b>{formatWith(-1234.5, { format: fmt })}</b></p>
{:else if col.type === 'numbering'}
  <div class="sub">Rules</div>
  <ReorderList items={nb.parts} onmove={movePart} disabled={ro} label="Drag to reorder the rules">
    {#snippet row(part, i)}
      <div class="part">
        {#if part.kind === 'text'}
          <input aria-label="Text" value={part.text} disabled={ro} placeholder="Text, e.g. INV-" autocapitalize="off" spellcheck="false"
            onchange={(e) => setPart(i, { ...part, text: val(e) })} />
        {:else}
          <span class="kind">Number</span>
          <select aria-label="Digits" value={String(part.digits)} disabled={ro} onchange={(e) => setPart(i, { ...part, digits: Number(val(e)) })}>
            {#each [1, 2, 3, 4, 5, 6, 7, 8] as d (d)}<option value={String(d)}>{d} digit{d === 1 ? '' : 's'}</option>{/each}
          </select>
        {/if}
        {#if !ro && nb.parts.length > 1}
          <button class="x" aria-label="Remove rule" title="Remove rule" onclick={() => setNumbering({ ...nb, parts: nb.parts.filter((p) => p.id !== part.id) })}><Icon name="close" size={14} /></button>
        {/if}
      </div>
    {/snippet}
  </ReorderList>
  {#if !ro}
    <div class="buttons">
      <button onclick={() => setNumbering({ ...nb, parts: [...nb.parts, { id: uid(), kind: 'text', text: '' }] })}>+ Text</button>
      <button onclick={() => setNumbering({ ...nb, parts: [...nb.parts, { id: uid(), kind: 'seq', digits: 4 }] })}>+ Number</button>
    </div>
  {/if}
  <label>Start at
    <input type="number" inputmode="numeric" value={nb.start} disabled={ro} onchange={(e) => setNumbering({ ...nb, start: Math.round(Number(val(e)) || 1) })} />
  </label>
  <p class="hint">Preview: <b>{preview}</b></p>
  <p class="hint">Each new row gets the next number and keeps it, even when rows are sorted, moved or deleted.</p>
  {#if !ro}<button onclick={() => app.renumber(table.id, col.id)}>Renumber All Rows</button>{/if}
{:else if col.type === 'select'}
  <div class="sub">Choices</div>
  <ReorderList items={options} onmove={moveOption} disabled={ro} label="Drag to reorder the choices">
    {#snippet row(o)}
      <div class="part">
        {#key o.label}<input aria-label="Choice" value={o.label} disabled={ro} autocapitalize="off" onchange={(e) => renameOption(o.id, val(e))} />{/key}
        {#if used.get(o.label)}<span class="count" title="Rows using this choice">{used.get(o.label)}</span>{/if}
        {#if !ro}
          <button class="x" aria-label={`Remove ${o.label}`} title="Remove choice (clears it from its rows)"
            onclick={() => setOptions(options.filter((x) => x.id !== o.id))}><Icon name="close" size={14} /></button>
        {/if}
      </div>
    {/snippet}
  </ReorderList>
  {#if !ro}<div class="buttons"><button onclick={addOption}>+ Choice</button></div>{/if}
  <label>Default for new rows
    <select value={col.defaultOption ?? ''} disabled={ro} onchange={(e) => app.setDefaultOption(table.id, col.id, val(e) || null)}>
      <option value="">Blank</option>
      {#each options as o (o.id)}<option value={o.id}>{o.label}</option>{/each}
    </select>
  </label>
  <p class="hint">Typing or pasting a value that isn't a choice adds it to the menu.</p>
{/if}

<style>
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 10px;
    color: var(--muted);
  }
  label.check {
    flex-direction: row;
    align-items: center;
    gap: 8px;
    color: var(--text);
  }
  input:not([type='checkbox']),
  select {
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: var(--radius-6);
    padding: 4px 8px;
    background: var(--panel);
    min-height: var(--field-h);
  }
  .sub {
    color: var(--muted);
    margin: 2px 0 4px;
  }
  .part {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .part input,
  .part select {
    flex: 1;
    min-width: 0;
  }
  .kind {
    color: var(--muted);
    white-space: nowrap;
  }
  .count {
    color: var(--muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .x {
    border: none;
    background: none;
    color: var(--muted);
    min-width: var(--touch-target);
    min-height: var(--control-h);
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0 0 10px;
  }
  .hint {
    color: var(--muted);
    line-height: 1.5;
    margin: 0 0 8px;
  }
</style>
