/**
 * Amazon FBA Inventory Reader (#4183)
 *
 * FBA stock per seller SKU from `getInventorySummaries` (FBA Inventory API
 * v1), at marketplace granularity, 50 SKUs a call (the API's limit for the
 * `sellerSkus` filter). Results are cached per adapter instance, so a batch
 * prefetch serves the per-product reads that follow.
 *
 * A SKU Amazon does not list has no FBA stock, which this reader reports as
 * zero units: the inventory master reports a FBA position for every variant,
 * because core prunes by variant and a FBA row it stopped receiving would keep
 * its last quantity.
 *
 * Not verified on a live account (#4183, research acceptance criterion); the
 * field names follow Amazon's published model.
 *
 * @module libs/integrations/amazon/src/infrastructure/readers
 */
import type {
  AmazonFbaInventorySummariesResponse,
  AmazonFbaInventorySummary,
  AmazonFbaStock,
} from '../../domain/types/amazon-fba-inventory.types';
import type { AmazonSpApiClient } from '../http/amazon-spapi-client';

const SUMMARIES_PATH = '/fba/inventory/v1/summaries';
/** `getInventorySummaries` takes at most 50 seller SKUs. */
export const AMAZON_FBA_SKUS_PER_CALL = 50;
/** A runaway `nextToken` loop is cut off here rather than followed forever. */
const MAX_PAGES_PER_CALL = 20;

export const NO_FBA_STOCK: AmazonFbaStock = { fulfillable: 0, reserved: 0, updatedAt: null };

export class AmazonFbaInventoryReader {
  private readonly cached = new Map<string, AmazonFbaStock>();

  constructor(
    private readonly client: AmazonSpApiClient,
    private readonly marketplaceId: string,
  ) {}

  /** FBA stock for each SKU (zero units for one Amazon does not list). */
  async read(skus: readonly string[]): Promise<Map<string, AmazonFbaStock>> {
    const missing = [...new Set(skus)].filter((sku) => !this.cached.has(sku));
    for (let start = 0; start < missing.length; start += AMAZON_FBA_SKUS_PER_CALL) {
      const batch = missing.slice(start, start + AMAZON_FBA_SKUS_PER_CALL);
      const found = await this.readSummaries(batch);
      for (const sku of batch) {
        this.cached.set(sku, found.get(sku) ?? NO_FBA_STOCK);
      }
    }
    return new Map(skus.map((sku) => [sku, this.cached.get(sku) ?? NO_FBA_STOCK]));
  }

  private async readSummaries(skus: readonly string[]): Promise<Map<string, AmazonFbaStock>> {
    const found = new Map<string, AmazonFbaStock>();
    let token: string | undefined;
    for (let page = 0; page < MAX_PAGES_PER_CALL; page += 1) {
      const response = await this.client.get<AmazonFbaInventorySummariesResponse>(SUMMARIES_PATH, {
        details: 'true',
        granularityType: 'Marketplace',
        granularityId: this.marketplaceId,
        marketplaceIds: [this.marketplaceId],
        sellerSkus: skus,
        ...(token ? { nextToken: token } : {}),
      });
      for (const summary of response.data.payload?.inventorySummaries ?? []) {
        if (typeof summary.sellerSku === 'string' && skus.includes(summary.sellerSku)) {
          found.set(summary.sellerSku, toStock(summary));
        }
      }
      token = response.data.pagination?.nextToken;
      if (!token) {
        return found;
      }
    }
    return found;
  }
}

function toStock(summary: AmazonFbaInventorySummary): AmazonFbaStock {
  const fulfillable = count(summary.inventoryDetails?.fulfillableQuantity);
  const reserved = count(summary.inventoryDetails?.reservedQuantity?.totalReservedQuantity);
  const updatedAt = summary.lastUpdatedTime ? new Date(summary.lastUpdatedTime) : null;
  return {
    fulfillable,
    reserved,
    updatedAt: updatedAt !== null && !Number.isNaN(updatedAt.getTime()) ? updatedAt : null,
  };
}

/** A missing or negative count is no units: Amazon omits a quantity it has none of. */
function count(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}
