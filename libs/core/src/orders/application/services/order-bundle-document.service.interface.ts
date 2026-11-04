/**
 * Order Bundle Document Service Interface (#3934)
 *
 * What documents and analytics need to know about the components of an order's
 * bundle lines, read from the order's FROZEN expansion.
 *
 * @module libs/core/src/orders/application/services
 */
import type { BundleDocumentPresentation } from '@openlinker/core/sales-documents';
import type { OrderRecord } from '../../domain/entities/order-record.entity';

/** One gift slot of an order line, with what it costs the seller. */
export interface GiftSlotCostLine {
  /** The commercial (bundle) line id. */
  lineId: string;
  /** The physical component line id. */
  componentLineId: string;
  variantId: string;
  /** Units of the gift for the whole line. */
  quantity: number;
  /** Net unit cost as the variant states it; `null` when none is recorded. */
  unitCostNet: string | null;
  costCurrency: string | null;
  /** `unitCostNet * quantity` in the order's currency; `null` when unknown or in another currency. */
  totalCostNet: number | null;
}

export interface IOrderBundleDocumentService {
  /**
   * The component data a document mapper needs, or `undefined` when the
   * source connection keeps sets as one line or the order carries no bundle.
   * Never throws: a failed read leaves the set as one line, which is the
   * default and what the buyer paid.
   */
  resolveForDocuments(
    record: OrderRecord,
    sourceConnectionId: string
  ): Promise<BundleDocumentPresentation | undefined>;

  /**
   * The gift slots of the order with their cost: the read the gift analytics
   * (#3943) and the order detail cost line build on. Empty when there is none.
   */
  getGiftSlotCosts(record: OrderRecord): Promise<GiftSlotCostLine[]>;
}
