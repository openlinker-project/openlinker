/**
 * Mirakl Master Identity
 *
 * The id rules both masters share (#4284): a product and its one variant are
 * keyed by the offer's `shop_sku`, under `Product` and `ProductVariant`
 * respectively, and its stock position by `stock:{shop_sku}` under
 * `Inventory`. Kept in one place so the catalogue and stock masters can never
 * disagree on which variant a position belongs to.
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters/catalog-master
 */
import { CORE_ENTITY_TYPE, type IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { MiraklConfigException } from '../../../domain/exceptions/mirakl-config.exception';

export class MiraklMasterIdentity {
  constructor(
    private readonly connectionId: string,
    private readonly identifierMapping: IdentifierMappingPort
  ) {}

  /**
   * The `shop_sku` behind an internal product id. A missing mapping is a
   * mapping gap (retryable, diagnosable), never a deletion.
   */
  async skuOf(internalProductId: string): Promise<string> {
    const mappings = await this.identifierMapping.getExternalIds(
      CORE_ENTITY_TYPE.Product,
      internalProductId
    );
    const sku = mappings.find((mapping) => mapping.connectionId === this.connectionId)?.externalId;
    if (!sku) {
      throw new MiraklConfigException(
        `Product ${internalProductId} has no offer mapping on connection ${this.connectionId}`,
        this.connectionId
      );
    }
    return sku;
  }

  /** Internal product ids for these skus, minted on first sight. */
  productIds(skus: readonly string[]): Promise<Map<string, string>> {
    return this.idsFor(
      skus.map((sku) => ({
        entityType: CORE_ENTITY_TYPE.Product,
        externalId: sku,
        connectionId: this.connectionId,
      }))
    );
  }

  /** The internal id of the offer's single variant, minted on first sight. */
  variantId(sku: string, internalProductId: string): Promise<string> {
    return this.identifierMapping.getOrCreateInternalId(
      CORE_ENTITY_TYPE.ProductVariant,
      sku,
      this.connectionId,
      {
        parentEntityType: CORE_ENTITY_TYPE.Product,
        parentInternalId: internalProductId,
        metadata: { variantExternalId: sku },
      }
    );
  }

  /** The internal id of the offer's stock position, minted on first sight. */
  inventoryId(sku: string, internalProductId: string): Promise<string> {
    return this.identifierMapping.getOrCreateInternalId(
      CORE_ENTITY_TYPE.Inventory,
      `stock:${sku}`,
      this.connectionId,
      { parentEntityType: CORE_ENTITY_TYPE.Product, parentInternalId: internalProductId }
    );
  }

  /** Map key `batchGetOrCreateInternalIds` answers under. */
  key(sku: string): string {
    return `${sku}:${this.connectionId}`;
  }

  private idsFor(
    requests: Parameters<IdentifierMappingPort['batchGetOrCreateInternalIds']>[0]
  ): Promise<Map<string, string>> {
    return requests.length === 0
      ? Promise.resolve(new Map<string, string>())
      : this.identifierMapping.batchGetOrCreateInternalIds(requests);
  }
}
