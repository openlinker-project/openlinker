/**
 * Order Buyer Data Retention Service Interface (#4178)
 *
 * Removes buyer personal data from orders whose source limits how long it may
 * be kept (`AdapterMetadata.buyerDataRetentionDays`; Amazon's Data Protection
 * Policy allows 30 days after delivery). Counted from the order's ship-by
 * deadline, else its placement, both of which precede delivery, so the
 * deletion is never later than the platform's limit.
 *
 * What is removed: the buyer's addresses (reduced to their country), email,
 * note, tax id and an operator's address edit, and the buyer from the search
 * text. Lines, amounts, statuses and ids stay. A re-import of a redacted order
 * stores none of it again (`OrderRecordService.persistOrder`).
 *
 * Not covered yet, and stated rather than implied: the customer projections,
 * a shipment's recipient, the history of an address edit and the recipient on
 * an email delivery record keep their copy. Issued sales documents keep theirs
 * by law.
 *
 * @module application/services
 */
import type { OrderBuyerDataRetentionRunResult } from '../../domain/types/order-buyer-data-retention.types';

export interface IOrderBuyerDataRetentionService {
  /** One bounded pass over every source that declares a retention period. Never throws for one connection. */
  runOnce(now?: Date): Promise<OrderBuyerDataRetentionRunResult>;
}
