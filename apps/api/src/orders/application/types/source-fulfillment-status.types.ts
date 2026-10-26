/**
 * Source Fulfillment Status Projection
 *
 * The operator-facing shape behind `GET /orders/:internalOrderId/source-fulfillment`
 * (#3365) — what the SOURCE marketplace says about an order right now, as
 * opposed to what OpenLinker recorded about it.
 *
 * The two are different facts and the endpoint exists because only one of them
 * was ever visible. `OrderStatusWriteback` (ADR-027) relays a dispatch mark and
 * a waybill INTO the marketplace and reads nothing back, so an operator whose
 * parcel "did not reach Allegro" had no way to check inside the product, and no
 * test in the repository could assert the marketplace side either.
 *
 * @module apps/api/src/orders/application/types
 */
import type { SourceFulfillmentReadback } from '@openlinker/core/orders';

/**
 * Why no marketplace answer is carried, beyond the adapter's own outcomes.
 *
 * `no-source-mapping` is the one case the adapter cannot report on, because it
 * is an OpenLinker-side fact: the order carries no external id on its source
 * connection, so there is nothing to ask about. It is NOT folded into
 * `unavailable`, which means the marketplace was asked and did not answer.
 */
export interface SourceFulfillmentStatusView {
  readonly internalOrderId: string;
  /** The connection the order was ingested from. */
  readonly sourceConnectionId: string;
  /** Its display name, so a surface need not fetch the connection to render one. */
  readonly sourceConnectionName: string | null;
  /** The source-native order id the answer is about; `null` when unmapped. */
  readonly externalOrderId: string | null;
  /**
   * The marketplace's answer. `null` only when there was nothing to ask -
   * see `unmappedReason`.
   */
  readonly readback: SourceFulfillmentReadback | null;
  /** Set exactly when `readback` is `null`. */
  readonly unmappedReason: 'no-source-mapping' | null;
  /** When OpenLinker asked. Always OpenLinker's clock - it is OUR act. */
  readonly readAt: string;
}
