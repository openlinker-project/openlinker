/**
 * Integrations Content Publisher
 *
 * Default `ContentPublisherPort` implementation. Routes master publishes
 * (`connectionId === null`) through `IntegrationsService.listCapabilityAdapters`
 * to the active `ProductMaster` adapter and calls `updateProduct(productId, { [fieldKey]: value })`.
 *
 * Channel publishes (`connectionId !== null`) throw
 * `ChannelContentPublishNotSupportedException` until #339 / #342 wire offer
 * discovery + `MarketplacePort.updateOfferFields`. The exception message
 * carries the follow-up issue references so the gap is self-documenting at
 * call sites.
 *
 * @module libs/core/src/content/application/services
 * @implements {ContentPublisherPort}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import { INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations/integrations.tokens';
import type { IIntegrationsService } from '@openlinker/core/integrations/application/interfaces/integrations.service.interface';
import type { ProductMasterPort } from '@openlinker/core/products/domain/ports/product-master.port';
import { ChannelContentPublishNotSupportedException } from '../../domain/exceptions/channel-content-publish-not-supported.exception';
import { ContentPublishMissingVersionException } from '../../domain/exceptions/content-publish-missing-version.exception';
import { NoProductMasterAdapterException } from '../../domain/exceptions/no-product-master-adapter.exception';
import type {
  ContentPublishRequest,
  ContentPublishResult,
  ContentPublisherPort,
} from '../../domain/ports/content-publisher.port';

@Injectable()
export class IntegrationsContentPublisher implements ContentPublisherPort {
  private readonly logger = new Logger(IntegrationsContentPublisher.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
  ) {}

  async publish(request: ContentPublishRequest): Promise<ContentPublishResult> {
    if (request.connectionId !== null) {
      throw new ChannelContentPublishNotSupportedException(
        request.productId,
        request.connectionId,
        request.fieldKey,
      );
    }

    const masters = await this.integrationsService.listCapabilityAdapters<ProductMasterPort>({
      capability: 'ProductMaster',
    });

    if (masters.length === 0) {
      throw new NoProductMasterAdapterException(request.productId, request.fieldKey);
    }

    if (masters.length > 1) {
      // Today there is at most one ProductMaster connection in practice, but the contract
      // returns an array. Log + pick the first; refine to an explicit selection rule
      // (e.g. the connection that owns the product) when multi-master is real.
      this.logger.warn(
        `[content] Multiple ProductMaster adapters resolved (${masters.length}); using the first. ` +
          `Refine selection when multi-master is wired.`,
      );
    }

    const { adapter } = masters[0];

    // Patch only the requested field — `ProductUpdate` accepts arbitrary string keys
    // via its index signature (`[key: string]: unknown`). Adapters that don't know
    // a particular field key simply ignore it; for `description` (the MVP key),
    // `PrestashopProductMasterAdapter` writes it through to PrestaShop.
    const updated = await adapter.updateProduct(request.productId, {
      [request.fieldKey]: request.value,
    });

    // Use the platform-derived `updatedAt` as the opaque baseVersion. ISO string
    // keeps the comparison purely lexical (we never order versions, only test
    // equality for divergence detection). Synthesising a local timestamp when
    // the adapter omits `updatedAt` would corrupt the conflict-detection
    // invariant — the next inbound reconcile would compare the platform's real
    // `updatedAt` against our fabricated value and falsely flag a conflict —
    // so we fail loud here. Adapters MUST populate Product.updatedAt on update.
    if (!updated.updatedAt) {
      throw new ContentPublishMissingVersionException(request.productId, request.fieldKey);
    }

    return { baseVersion: updated.updatedAt.toISOString() };
  }
}
