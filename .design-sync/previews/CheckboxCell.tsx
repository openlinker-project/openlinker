import { CheckboxCell } from '@openlinker/web';

/**
 * CheckboxCell is a bare native `<input type="checkbox">` (brand orange comes
 * from `accent-color: var(--accent-primary)`), so on its own it renders 14px
 * tall and reads as nothing. Every cell puts it in the selection context it
 * actually ships in — the DataTable header + row gutter on the products list.
 *
 * Rows are deliberately tight: the card viewport for this component is 320x120,
 * so anything past ~4 rows is clipped.
 */

const noop = () => {};

const row = { display: 'flex', alignItems: 'center', gap: 8, height: 22 } as const;
const label = { fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1 } as const;

export const States = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    <div style={row}>
      <CheckboxCell state="none" onToggle={noop} ariaLabel="Select all products" />
      <span style={label}>none — nothing selected</span>
    </div>
    <div style={row}>
      <CheckboxCell state="some" onToggle={noop} ariaLabel="Select all products" />
      <span style={label}>some — indeterminate</span>
    </div>
    <div style={row}>
      <CheckboxCell state="all" onToggle={noop} ariaLabel="Select all products" />
      <span style={label}>all — 24 of 24</span>
    </div>
    <div style={row}>
      <CheckboxCell
        state="none"
        onToggle={noop}
        disabled
        ariaLabel="Row unselectable"
        tooltip="Variant is stale"
      />
      <span style={{ ...label, color: 'var(--text-disabled)' }}>disabled — stale variant</span>
    </div>
  </div>
);

export const SelectionGutter = () => (
  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
    <caption className="sr-only">Products selection</caption>
    <thead>
      <tr style={{ height: 22 }}>
        <th style={{ width: 20, padding: 0 }}>
          <CheckboxCell state="some" onToggle={noop} ariaLabel="Select all products" />
        </th>
        <th
          className="mono"
          style={{ textAlign: 'left', padding: 0, color: 'var(--text-muted)', fontWeight: 600 }}
        >
          SKU
        </th>
        <th
          style={{ textAlign: 'right', padding: 0, color: 'var(--text-muted)', fontWeight: 600 }}
        >
          Stock
        </th>
      </tr>
    </thead>
    <tbody>
      {[
        { sku: 'SKU-9182', state: 'all' as const, stock: '128' },
        { sku: 'SKU-3310', state: 'none' as const, stock: '0' },
        { sku: 'SKU-4471', state: 'all' as const, stock: '46' },
      ].map((r) => (
        <tr key={r.sku} style={{ height: 22 }}>
          <td style={{ padding: 0 }}>
            <CheckboxCell state={r.state} onToggle={noop} ariaLabel={`Select ${r.sku}`} />
          </td>
          <td className="mono tabular" style={{ padding: 0 }}>
            {r.sku}
          </td>
          <td className="mono tabular" style={{ padding: 0, textAlign: 'right' }}>
            {r.stock}
          </td>
        </tr>
      ))}
    </tbody>
  </table>
);
