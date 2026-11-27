/**
 * Amazon Buyer Data Window Policy
 *
 * Amazon's Data Protection Policy lets a seller keep a buyer's personal data
 * for at most 30 days. Core removes it after that through the buyer-data
 * retention pass (`buyerDataRetentionDays` on the manifest), anchored on the
 * order's dispatch-by deadline, else its placement date: for Amazon the end
 * of `shipByWindow`, else `createdTime`. This policy applies the same window,
 * from the same anchor, BEFORE the data is
 * fetched: an order already past it is read without the `BUYER` and
 * `RECIPIENT` blocks, so importing history (a connection that starts from
 * "all orders" or from an old date, or one that gained a marketplace) never
 * pulls personal data Amazon would have it delete again.
 *
 * An order whose anchor cannot be read is treated as inside the window: the
 * retention pass still removes its data once the anchor passes.
 *
 * @module libs/integrations/amazon/src/domain/policies
 */

/** Days a buyer's personal data may be kept (Amazon's Data Protection Policy). */
export const AMAZON_BUYER_DATA_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The order times the window is measured from, as Amazon reports them. */
export interface AmazonBuyerDataAnchor {
  readonly createdTime: string;
  readonly shipByLatest?: string;
}

/** True while the order may still carry its buyer's personal data. */
export function isWithinAmazonBuyerDataWindow(anchor: AmazonBuyerDataAnchor, now: Date): boolean {
  const shipBy = anchor.shipByLatest === undefined ? Number.NaN : Date.parse(anchor.shipByLatest);
  const from = Number.isNaN(shipBy) ? Date.parse(anchor.createdTime) : shipBy;
  if (Number.isNaN(from)) {
    return true;
  }
  return now.getTime() - from < AMAZON_BUYER_DATA_RETENTION_DAYS * DAY_MS;
}
