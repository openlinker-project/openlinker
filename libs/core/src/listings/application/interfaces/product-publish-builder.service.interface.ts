/**
 * Product Publish Builder Service Interface
 *
 * Contract for assembling a platform-neutral `PublishProductCommand` from an OL
 * internal variant id plus shop publish options. Implementations resolve the
 * parent master product, provision the destination category (open-provenance),
 * project attributes into neutral `OfferParameter[]`, and assemble the command
 * consumed by `ShopProductManagerPort.publishProduct`.
 *
 * @module libs/core/src/listings/application/interfaces
 */

import type { PublishProductCommand } from '@openlinker/core/listings';
import type { BuildPublishProductCommandInput } from '../types/product-publish-builder.types';

export interface IProductPublishBuilderService {
  /**
   * Resolve and assemble a `PublishProductCommand` for the given variant and
   * shop connection.
   *
   * Failure modes:
   * - Unknown variant → `ProductPublishBuilderValidationException` (`internalVariantId`, `NOT_FOUND`)
   * - Unknown shop connection → `ConnectionNotFoundException`
   * - Shop connection missing `masterCatalogConnectionId` in config →
   *   `MasterCatalogConnectionNotConfiguredException`
   * - Cannot resolve price/currency → `ProductPublishBuilderValidationException` (`price.*`, `REQUIRED`)
   * - Unresolved required destination parameter → `ProductPublishBuilderValidationException`
   *   (`parameters.*`, `PARAMETER_REQUIRED`)
   *
   * Category placement is best-effort (open-provenance provisioning when the
   * destination supports `CategoryProvisioner`; otherwise uncategorised — not a
   * gate failure, since shops publish uncategorised products).
   */
  buildPublishProductCommand(
    input: BuildPublishProductCommandInput
  ): Promise<PublishProductCommand>;
}
