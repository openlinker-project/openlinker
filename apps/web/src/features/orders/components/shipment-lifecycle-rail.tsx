/**
 * Shipment Lifecycle Rail (#1425)
 *
 * Horizontal 4-stage tracker for the order-detail shipment panel:
 * Label ready → Dispatched → In transit → Delivered. Mirrors the buyer-side
 * tracker the marketplace already shows. Maps a persisted `ShipmentStatus`
 * onto the stage sequence; terminal-exception statuses (`failed` / `cancelled`)
 * render an interrupted rail whose halt node sits at the dispatch stage.
 *
 * Presentational only — no data fetching. Status colour is semantic; the accent
 * is reserved for the current live node.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement } from 'react';

import type { ShipmentStatus } from '../../shipments';

const STAGE_LABELS = ['Label ready', 'Dispatched', 'In transit', 'Delivered'] as const;

/**
 * The stage index each status "lives" at. Terminal-exception statuses halt at
 * the dispatch stage (index 1) — the furthest point a shipment reaches before
 * an operator/carrier rejection or cancellation.
 */
const STAGE_INDEX: Record<ShipmentStatus, number> = {
  draft: 0,
  generated: 0,
  dispatched: 1,
  'in-transit': 2,
  delivered: 3,
  failed: 1,
  cancelled: 1,
};

/** Non-terminal statuses whose current node gently pulses (guarded by reduced-motion). */
const LIVE_STATUSES: ReadonlySet<ShipmentStatus> = new Set<ShipmentStatus>([
  'draft',
  'generated',
  'dispatched',
  'in-transit',
]);

type StageState = 'done' | 'current' | 'upcoming' | 'halt';

interface RailStage {
  label: string;
  state: StageState;
  live: boolean;
}

interface ShipmentLifecycleRailProps {
  status: ShipmentStatus;
}

function buildStages(status: ShipmentStatus): RailStage[] {
  const current = STAGE_INDEX[status];
  const halted = status === 'failed' || status === 'cancelled';
  const haltLabel = status === 'failed' ? 'Dispatch failed' : 'Cancelled';

  return STAGE_LABELS.map((label, index): RailStage => {
    if (index < current) {
      return { label, state: 'done', live: false };
    }
    if (index === current) {
      if (halted) {
        return { label: haltLabel, state: 'halt', live: false };
      }
      // `delivered` is the terminal success node: current + done, never live.
      return { label, state: 'current', live: LIVE_STATUSES.has(status) };
    }
    return { label, state: 'upcoming', live: false };
  });
}

const STATE_MODIFIER: Record<StageState, string> = {
  done: 'shipment-lifecycle-rail__step--done',
  current: 'shipment-lifecycle-rail__step--current',
  upcoming: '',
  halt: 'shipment-lifecycle-rail__step--halt shipment-lifecycle-rail__step--current',
};

export function ShipmentLifecycleRail({ status }: ShipmentLifecycleRailProps): ReactElement {
  const stages = buildStages(status);
  const delivered = status === 'delivered';

  const rootClasses = [
    'shipment-lifecycle-rail',
    status === 'failed' ? 'shipment-lifecycle-rail--halted' : '',
    status === 'cancelled' ? 'shipment-lifecycle-rail--cancelled' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <ol className={rootClasses} aria-label="Shipment lifecycle">
      {stages.map((stage, index) => {
        const doneModifier =
          stage.state === 'done' || (delivered && stage.state === 'current')
            ? 'shipment-lifecycle-rail__step--done'
            : '';
        const stepClasses = [
          'shipment-lifecycle-rail__step',
          STATE_MODIFIER[stage.state],
          doneModifier,
          stage.live ? 'shipment-lifecycle-rail__step--live' : '',
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <li
            key={index}
            className={stepClasses}
            aria-current={stage.state === 'current' || stage.state === 'halt' ? 'step' : undefined}
          >
            <span className="shipment-lifecycle-rail__node" aria-hidden="true" />
            <span className="shipment-lifecycle-rail__label">{stage.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
