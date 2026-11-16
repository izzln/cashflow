<script lang="ts">
  import { condOps, NO_VALUE_OPS } from '../lib/columns';
  import type { Condition, CondOp, DataTable } from '../lib/model';

  /** Column · test · value(s) for a row filter rule or a highlighting rule. Commits on change. */
  let { table, cond, onchange, disabled = false }: {
    table: DataTable;
    cond: Condition;
    onchange: (patch: Partial<Condition>) => void;
    disabled?: boolean;
  } = $props();

  const col = $derived(table.columns.find((c) => c.id === cond.col) ?? table.columns[0]);
  const ops = $derived(condOps(col.type));
  const needsValue = $derived(!NO_VALUE_OPS.includes(cond.op));
  const val = (e: Event) => (e.currentTarget as HTMLInputElement | HTMLSelectElement).value;

  function setColumn(id: string) {
    const next = table.columns.find((c) => c.id === id);
    if (!next) return;
    const nextOps = condOps(next.type);
    // Keep the test when the new column offers it; otherwise start from its first one.
    const op = nextOps.some((o) => o.op === cond.op) ? cond.op : nextOps[0].op;
    onchange({ col: id, op, value: next.type === col.type ? cond.value : '', value2: '' });
  }
</script>

<div class="cond">
  <select aria-label="Column" value={col.id} {disabled} onchange={(e) => setColumn(val(e))}>
    {#each table.columns as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
  </select>
  <select aria-label="Test" value={cond.op} {disabled} onchange={(e) => onchange({ op: val(e) as CondOp })}>
    {#each ops as o (o.op)}<option value={o.op}>{o.label}</option>{/each}
  </select>
  {#if needsValue}
    {#if col.type === 'select'}
      <select aria-label="Value" value={cond.value} {disabled} onchange={(e) => onchange({ value: val(e) })}>
        <option value="">Choose…</option>
        {#each col.options ?? [] as o (o.id)}<option value={o.label}>{o.label}</option>{/each}
      </select>
    {:else}
      <div class="values">
        <input aria-label="Value" {disabled} type={col.type === 'date' ? 'date' : 'text'} inputmode={col.type === 'number' ? 'decimal' : undefined}
          value={cond.value} placeholder={col.type === 'number' ? '0' : 'Value'} autocapitalize="off" spellcheck="false"
          onchange={(e) => onchange({ value: val(e) })} />
        {#if cond.op === 'between'}
          <span class="and">and</span>
          <input aria-label="Second value" {disabled} type={col.type === 'date' ? 'date' : 'text'} inputmode={col.type === 'number' ? 'decimal' : undefined}
            value={cond.value2} placeholder={col.type === 'number' ? '100' : 'Value'} autocapitalize="off" spellcheck="false"
            onchange={(e) => onchange({ value2: val(e) })} />
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .cond {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .values {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .values input {
    flex: 1;
    min-width: 0;
  }
  .and {
    color: var(--muted);
  }
  input,
  select {
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: var(--radius-6);
    padding: 4px 8px;
    background: var(--panel);
    min-height: var(--field-h);
    width: 100%;
  }
</style>
