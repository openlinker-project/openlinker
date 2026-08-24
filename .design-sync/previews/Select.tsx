import { Select } from '@openlinker/web';

/**
 * Ported from the "Form controls" group at /dev/ui
 * (apps/web/src/pages/dev-ui/sections/primitives-section.tsx) — the adapter
 * picker uses exactly these options. Select is a native `<select>` wearing the
 * shared `.control` surface, so the closed state is the whole render; the
 * expanded option list is drawn by the OS and cannot be captured statically.
 */

const stack = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-3)',
  maxWidth: 420,
};

export const Default = () => (
  <div style={stack}>
    <Select defaultValue="allegro.publicapi.v1">
      <option value="allegro.publicapi.v1">allegro.publicapi.v1</option>
      <option value="prestashop.webservice.v1">prestashop.webservice.v1</option>
      <option value="shopify.admin.v2">shopify.admin.v2</option>
    </Select>
  </div>
);

export const Placeholder = () => (
  <div style={stack}>
    <Select defaultValue="">
      <option value="" disabled>
        Select a destination connection…
      </option>
      <option value="c_4f8a">Main Allegro store</option>
      <option value="c_71bd">Erli — production</option>
      <option value="c_0c19">WooCommerce — outlet</option>
    </Select>
  </div>
);

export const Invalid = () => (
  <div style={stack}>
    <Select defaultValue="" invalid>
      <option value="" disabled>
        Select a trigger model…
      </option>
      <option value="manual">Manual</option>
      <option value="automatic">Automatic on payment</option>
      <option value="batched">Batched (daily)</option>
    </Select>
  </div>
);

export const Disabled = () => (
  <div style={stack}>
    <Select defaultValue="pln" disabled>
      <option value="pln">PLN — reporting currency</option>
      <option value="eur">EUR</option>
    </Select>
  </div>
);

export const Grouped = () => (
  <div style={stack}>
    <Select defaultValue="allegro-257">
      <optgroup label="Marketplace">
        <option value="allegro-257">Allegro · Odzież damska (257)</option>
        <option value="allegro-9021">Allegro · Obuwie sportowe (9021)</option>
      </optgroup>
      <optgroup label="Shop">
        <option value="woo-14">WooCommerce · Sale / Outlet (14)</option>
        <option value="woo-22">WooCommerce · New arrivals (22)</option>
      </optgroup>
    </Select>
  </div>
);
