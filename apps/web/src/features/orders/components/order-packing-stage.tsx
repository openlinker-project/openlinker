/**
 * Order Packing Stage (#3482)
 *
 * The packing position of an order OpenLinker handles itself, in the Shipment
 * column. A workflow POSITION, so a tick-style marker beside its label rather
 * than a pill (the `OrderPackedTick` anatomy, mockup rule 2). Renders nothing
 * when OpenLinker found no live work.
 *
 * One renderer, two layouts - the `OrderPackedTick` contract - so the desktop
 * cell and the mobile card cannot drift.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement } from 'react';
import type { OrderHandledInOpenLinker } from '../api/orders.types';
import { derivePackingStage } from '../lib/handled-in-openlinker';

export interface OrderPackingStageProps {
  handled: OrderHandledInOpenLinker | undefined;
}

export function OrderPackingStage({ handled }: OrderPackingStageProps): ReactElement | null {
  const view = derivePackingStage(handled);
  if (!view) return null;
  return (
    <span
      className={`orders-packed-tick orders-packed-tick--${view.stage}`}
      title={view.hint}
    >
      <span className="orders-packed-tick__mark" aria-hidden="true">
        {view.mark}
      </span>
      <span className="orders-packed-tick__label">{view.label}</span>
      <span className="sr-only">{` - ${view.hint}`}</span>
    </span>
  );
}
