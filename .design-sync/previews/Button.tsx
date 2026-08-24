import { Button } from '@openlinker/web';

/**
 * Ported from the repo's own design system at /dev/ui
 * (apps/web/src/pages/dev-ui/sections/primitives-section.tsx) — same tones,
 * same sizes, same copy, so the cards match what the team already reviews.
 */

export const Tones = () => (
  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
    <Button tone="primary">Save changes</Button>
    <Button tone="secondary">Cancel</Button>
    <Button tone="ghost">View history</Button>
    <Button tone="danger">Delete connection</Button>
  </div>
);

export const Sizes = () => (
  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
    <Button tone="primary" className="button--xs">Approve</Button>
    <Button tone="primary" className="button--sm">Approve</Button>
    <Button tone="primary" className="button--md">Approve</Button>
    <Button tone="primary" className="button--lg">Approve</Button>
  </div>
);

export const WithLeadingGlyph = () => (
  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
    <Button tone="secondary"><span aria-hidden="true">＋</span> Add connection</Button>
    <Button tone="ghost"><span aria-hidden="true">⟳</span> Sync now</Button>
  </div>
);

export const Disabled = () => (
  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
    <Button tone="primary" disabled>Save changes</Button>
    <Button tone="secondary" disabled>Cancel</Button>
    <Button tone="danger" disabled>Delete connection</Button>
  </div>
);
