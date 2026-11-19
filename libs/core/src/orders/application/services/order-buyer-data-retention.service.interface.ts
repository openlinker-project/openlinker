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
 * text; the recipient address on the order's buyer-email and document-email
 * delivery records; and the email, names and street addresses of the customer
 * projections last seen through the source before the cutoff (hashes and
 * countries stay). Lines, amounts, statuses and ids stay. A re-import of a
 * redacted order stores none of it again on the order
 * (`OrderRecordService.persistOrder`); a customer seen again is cleared again
 * once that sighting is past the period.
 *
 * Kept, and stated rather than implied: issued sales documents keep the buyer
 * by law, and a carrier label already generated keeps the recipient printed on
 * it. What a destination shop or ERP received is outside OpenLinker.
 *
 * @module application/services
 */
import type { OrderBuyerDataRetentionRunResult } from '../../domain/types/order-buyer-data-retention.types';

export interface IOrderBuyerDataRetentionService {
  /** One bounded pass over every source that declares a retention period. Never throws for one connection. */
  runOnce(now?: Date): Promise<OrderBuyerDataRetentionRunResult>;
}
