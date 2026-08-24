import { Combobox } from '@openlinker/web';

/**
 * Combobox is a controlled Radix-Popover trigger + virtualized listbox. The
 * popover panel only mounts on interaction, so these cards show the closed
 * trigger — the state that actually renders statically. `value`/`onChange` are
 * required props; a no-op onChange keeps each card at a fixed state.
 *
 * Content mirrors the real consumer: Allegro category parameters, where the
 * `Marka` dictionary is ~5000 entries and free text is allowed for some fields.
 */

const brands = [
  { id: '11323_1', label: 'Reserved', hint: '11323_1' },
  { id: '11323_2', label: 'Zara', hint: '11323_2' },
  { id: '11323_3', label: 'H&M', hint: '11323_3' },
  { id: '11323_4', label: 'Mohito', hint: '11323_4' },
];

const colours = [
  { id: 'c_black', label: 'Czarny', hint: 'c_black' },
  { id: 'c_navy', label: 'Granatowy', hint: 'c_navy' },
  { id: 'c_beige', label: 'Beżowy', hint: 'c_beige' },
];

const noop = () => {};

const stack = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-3)',
  maxWidth: 420,
};

export const SingleSelected = () => (
  <div style={stack}>
    <Combobox
      ariaLabel="Marka"
      options={brands}
      value={{ kind: 'dictionary', ids: ['11323_1'] }}
      onChange={noop}
    />
  </div>
);

export const EmptyPlaceholder = () => (
  <div style={stack}>
    <Combobox
      ariaLabel="Marka"
      options={brands}
      value={null}
      onChange={noop}
      placeholder="Search 5,214 brands…"
    />
  </div>
);

export const MultiSelected = () => (
  <div style={stack}>
    <Combobox
      ariaLabel="Kolor dominujący"
      mode="multi"
      options={colours}
      value={{ kind: 'dictionary', ids: ['c_black', 'c_navy'] }}
      onChange={noop}
    />
  </div>
);

export const CustomValue = () => (
  <div style={stack}>
    <Combobox
      ariaLabel="Materiał"
      options={brands}
      allowCustomValues
      value={{ kind: 'custom', text: 'Bawełna organiczna 95% / elastan 5%' }}
      onChange={noop}
    />
  </div>
);

export const Invalid = () => (
  <div style={stack}>
    <Combobox
      ariaLabel="Marka"
      options={brands}
      value={null}
      onChange={noop}
      invalid
      placeholder="Required by category 257"
    />
  </div>
);

export const Disabled = () => (
  <div style={stack}>
    <Combobox
      ariaLabel="Marka"
      options={brands}
      value={{ kind: 'dictionary', ids: ['11323_2'] }}
      onChange={noop}
      disabled
    />
  </div>
);
