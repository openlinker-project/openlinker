import { Textarea } from '@openlinker/web';

/**
 * Ported from the "Form controls" group at /dev/ui
 * (apps/web/src/pages/dev-ui/sections/primitives-section.tsx).
 * Textarea shares the `.control` surface with Input — same border, radius and
 * focus ring; `invalid` mirrors the danger tone.
 */

const stack = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-3)',
  maxWidth: 460,
};

export const Default = () => (
  <div style={stack}>
    <Textarea
      rows={3}
      defaultValue="Seller froze stock on 2026-05-19; do not re-enable quantity write-back until finance confirms."
    />
  </div>
);

export const Placeholder = () => (
  <div style={stack}>
    <Textarea rows={3} placeholder="Operational notes for the team…" />
  </div>
);

export const Invalid = () => (
  <div style={stack}>
    <Textarea
      rows={3}
      invalid
      defaultValue="<script>alert(1)</script> Ships in 24h from our Warsaw warehouse."
    />
  </div>
);

export const Disabled = () => (
  <div style={stack}>
    <Textarea
      rows={3}
      disabled
      defaultValue="Description is published from the master catalogue and cannot be edited on this channel."
    />
  </div>
);

export const ReadOnly = () => (
  <div style={stack}>
    <Textarea
      rows={3}
      readOnly
      defaultValue={
        'Rejected by Allegro: ProductConstraintViolationException.DataIntegrity\n' +
        'Offer 12894410231 — category 257 requires parameter “Marka”.'
      }
    />
  </div>
);
