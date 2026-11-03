/**
 * Why this screen is not a duplicate of Orders (#3102)
 *
 * The two-column comparison the reviewed mockup places directly under the page
 * title, above the hero (`#detailView`,
 * `docs/plans/mockups/fulfillment-work-detail-3096.html`). An order is one
 * commercial row always; a task here is one physical packing job, and one
 * order becomes several tasks the moment it ships from more than one place.
 * An operator who does not know that reads the extra rows as a bug.
 *
 * ## Always visible, never behind a disclosure
 *
 * The reader who needs this explanation is the one who does not know they
 * need it, so it cannot sit behind a "what is this?" toggle — a collapsed
 * panel reaches nobody. There is deliberately no `<details>`, no toggle and no
 * dismissal here, and no state at all for one to hang off.
 *
 * ## No worked example (#3096 review)
 *
 * The mockup's "e.g." block — an order whose shoe box ships from Warsaw and
 * whose earbuds ship from Berlin — was removed from both the mockup and this
 * component. With one warehouse and no WMS, every order IS one task, so the
 * example described a situation the operator's own install cannot produce and
 * read as a claim about it. If multi-warehouse sourcing ships, the example can
 * return behind that condition.
 *
 * The component takes no props, so it cannot be made to interpolate the task
 * on screen into an explanation — that guarantee is structural.
 *
 * ## Every sentence comes from the copy table, none from here
 *
 * `check-ui-vocabulary.mjs` reads every string literal out of a `*.copy.ts`
 * and only JSX text plus an attribute allow-list out of a `.tsx`. Rendering
 * the four constants keeps the gate's view of this block complete.
 *
 * The mockup bolds a fragment (`<b>overall</b>`); the copy constants are plain
 * strings carrying no emphasis markers, so the sentences render whole rather
 * than re-deriving offsets that would silently drift after a copy edit.
 *
 * @module apps/web/src/features/fulfillment/components
 */
import type { ReactElement } from 'react';

import { FULFILLMENT_WORK_DETAIL_COPY } from '../lib/fulfillment-work-detail.copy';

const COPY = FULFILLMENT_WORK_DETAIL_COPY.vsOrders;

/**
 * No props, deliberately — see the module docblock. Kept as an exported type
 * so there is one place to widen if the component ever needs something (a
 * `className` passthrough, say) rather than changing the signature's shape.
 */
export type FulfillmentVsOrdersExplainerProps = Record<string, never>;

/**
 * A description list rather than the mockup's bare `div`s: each half really
 * is a term and its description. It also means the block needs no invented
 * `aria-label` to be readable — any such label would be a sentence with no
 * entry in the copy table.
 */
export function FulfillmentVsOrdersExplainer(): ReactElement {
  return (
    <div className="fulfilment-work-detail__vs-orders">
      <dl className="fulfilment-work-detail__compare">
        <div className="fulfilment-work-detail__compare-col">
          <dt className="fulfilment-work-detail__compare-label">{COPY.ordersLabel}</dt>
          <dd className="fulfilment-work-detail__compare-text">{COPY.ordersText}</dd>
        </div>
        <div className="fulfilment-work-detail__compare-col fulfilment-work-detail__compare-col--this">
          <dt className="fulfilment-work-detail__compare-label">{COPY.taskLabel}</dt>
          <dd className="fulfilment-work-detail__compare-text">{COPY.taskText}</dd>
        </div>
      </dl>
    </div>
  );
}
