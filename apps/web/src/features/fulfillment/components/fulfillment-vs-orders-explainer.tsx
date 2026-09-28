/**
 * Why this screen is not a duplicate of Orders (#3102)
 *
 * The two-column comparison and the worked example the reviewed mockup places
 * directly under the page title, above the hero (`#detailView`,
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
 * ## The example is fixed prose and is never interpolated from the task
 *
 * `vsOrders.exampleText` names an illustrative order, a shoe box and a pair of
 * earbuds. Substituting the task on screen would turn an explanation into a
 * claim about the operator's own order — a claim that is false for the
 * single-location task most of them are looking at. The component therefore
 * takes no props at all rather than taking the task and choosing not to read
 * it, which is what makes the guarantee structural instead of a convention.
 *
 * ## Every sentence comes from the copy table, none from here
 *
 * `check-ui-vocabulary.mjs` reads every string literal out of a `*.copy.ts`
 * and only JSX text plus an attribute allow-list out of a `.tsx`. Rendering
 * the six constants keeps the gate's view of this block complete, and keeps
 * one wording per idea when a reviewer edits the table.
 *
 * ## Two deliberate divergences from the mockup
 *
 * 1. The mockup's example is introduced by a mono `e.g.` glyph; the copy
 *    table's `examplePrefix` is the word "For example". The table is the
 *    authority on words, the mockup on layout, so the word goes in the
 *    glyph's slot — and because a word is wider than a glyph, that slot wraps
 *    instead of holding a fixed column open on a narrow screen.
 * 2. The mockup bolds three fragments (`<b>overall</b>`, the order id, "two
 *    separate tasks"). The copy constants are plain strings carrying no
 *    emphasis markers, and re-deriving the offsets in this file would mean
 *    either a literal of operator prose or an index that silently points at
 *    the wrong words after the next copy edit. So the sentences render
 *    whole.
 *
 * @module apps/web/src/features/fulfillment/components
 */
import type { ReactElement } from 'react';

import { FULFILLMENT_WORK_DETAIL_COPY } from '../lib/fulfillment-work-detail.copy';

const COPY = FULFILLMENT_WORK_DETAIL_COPY.vsOrders;

/**
 * No props, deliberately — see the module docblock. Kept as an exported type
 * so there is one place to widen if the finished component ever needs
 * something (a `className` passthrough, say) rather than changing the
 * signature's shape.
 *
 * It must NOT grow a task: the example's guarantee is that it cannot be
 * interpolated, and a component with no access to a task cannot interpolate
 * one.
 */
export type FulfillmentVsOrdersExplainerProps = Record<string, never>;

/**
 * A description list rather than the mockup's bare `div`s: each half really
 * is a term and its description, and `dl > div > dt + dd` is the shape this
 * feature's own `.fulfilment-task__facts` already uses. It also means the
 * block needs no invented `aria-label` to be readable — which matters,
 * because any such label would be a seventh sentence with no entry in the
 * copy table.
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

      <div className="fulfilment-work-detail__example">
        <span className="fulfilment-work-detail__example-glyph">{COPY.examplePrefix}</span>
        <p className="fulfilment-work-detail__example-text">{COPY.exampleText}</p>
      </div>
    </div>
  );
}
