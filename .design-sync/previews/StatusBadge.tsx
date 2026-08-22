import { StatusBadge } from '@openlinker/web';

/**
 * Ported from /dev/ui (primitives-section.tsx). The house rule the cards must
 * show: colour is never the only signal — the dot is the secondary one, and the
 * label is mono + caps so status reads as a label rather than prose.
 */

export const Tones = () => (
  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
    <StatusBadge withDot>Idle</StatusBadge>
    <StatusBadge tone="info" withDot>Syncing</StatusBadge>
    <StatusBadge tone="success" withDot>Live</StatusBadge>
    <StatusBadge tone="warning" withDot>Stale 14m</StatusBadge>
    <StatusBadge tone="error" withDot>Failed</StatusBadge>
    <StatusBadge tone="review" withDot>Needs review</StatusBadge>
  </div>
);

/**
 * `solid` is TONE-INDEPENDENT: `.status-badge--solid` paints a single
 * high-emphasis chip (`--text-primary` on `--text-inverse`) and there is no
 * tone-specific solid rule in index.css. So this cell contrasts solid against
 * the default treatment rather than sweeping tones — a tone sweep here would
 * render three identical chips and teach the wrong thing.
 */
export const Solid = () => (
  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
    <StatusBadge withDot>Draft</StatusBadge>
    <StatusBadge solid>Draft</StatusBadge>
  </div>
);

export const WithoutDot = () => (
  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
    <StatusBadge tone="success">Live</StatusBadge>
    <StatusBadge tone="warning">Stale 14m</StatusBadge>
    <StatusBadge tone="error">Failed</StatusBadge>
  </div>
);
