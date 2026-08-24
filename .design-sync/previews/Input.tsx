import { Input } from '@openlinker/web';

/**
 * Ported from the repo's own design system at /dev/ui
 * (apps/web/src/pages/dev-ui/sections/primitives-section.tsx, "Form controls"):
 * 32 px control height, shared focus ring, invalid state mirrors the danger tone.
 */

const stack = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-3)',
  maxWidth: 420,
};

export const Default = () => (
  <div style={stack}>
    <Input defaultValue="Main Allegro store" />
    <Input placeholder="https://api.openlinker.com/webhooks/allegro/c_4f8a" />
  </div>
);

export const Invalid = () => (
  <div style={stack}>
    <Input defaultValue="not-an-email" invalid aria-invalid />
    <Input defaultValue="*/5 * * * * *" invalid aria-invalid />
  </div>
);

export const Disabled = () => (
  <div style={stack}>
    <Input defaultValue="https://api.openlinker.com/webhooks/allegro/c_4f8a" disabled />
    <Input defaultValue="allegro.publicapi.v1" disabled />
  </div>
);

export const Types = () => (
  <div style={stack}>
    <Input type="number" defaultValue={3} />
    <Input type="password" defaultValue="cred_ref_9f2ac41" />
    <Input type="date" defaultValue="2026-05-23" />
  </div>
);

export const ReadOnly = () => (
  <div style={stack}>
    <Input defaultValue="ol_product_fce2df4d853f4499b955a6bb1a212bd1" readOnly />
  </div>
);
