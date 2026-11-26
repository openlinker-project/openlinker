/**
 * Amazon FBA Inventory Wire Types (#4183)
 *
 * The subset of the FBA Inventory API v1 (`getInventorySummaries`) the
 * inventory master reads, from Amazon's published model
 * (`fba-inventory-api-model/fbaInventory.json`).
 *
 * @module libs/integrations/amazon/src/domain/types
 */

export interface AmazonFbaReservedQuantity {
  /** Units Amazon holds for its own pending orders and transfers. */
  readonly totalReservedQuantity?: number;
}

export interface AmazonFbaInventoryDetails {
  /** Units Amazon can pick and ship now. */
  readonly fulfillableQuantity?: number;
  readonly reservedQuantity?: AmazonFbaReservedQuantity;
}

export interface AmazonFbaInventorySummary {
  readonly sellerSku?: string;
  readonly asin?: string;
  readonly fnSku?: string;
  readonly inventoryDetails?: AmazonFbaInventoryDetails;
  readonly totalQuantity?: number;
  /** ISO 8601. */
  readonly lastUpdatedTime?: string;
}

export interface AmazonFbaInventorySummariesResponse {
  readonly payload?: {
    readonly inventorySummaries?: readonly AmazonFbaInventorySummary[];
  };
  readonly pagination?: { readonly nextToken?: string };
}

/** One SKU's FBA stock as the inventory master reports it. */
export interface AmazonFbaStock {
  readonly fulfillable: number;
  readonly reserved: number;
  readonly updatedAt: Date | null;
}
