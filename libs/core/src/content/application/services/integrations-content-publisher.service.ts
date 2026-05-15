/**
 * Integrations Content Publisher
 *
 * Default `ContentPublisherPort` implementation. Routes publishes to the
 * correct external system based on whether the target is the master
 * (`connectionId === null`) or a channel:
 *
 *   - **Master path**: resolves a `ProductMaster` adapter via the
 *     integrations registry and calls `updateProduct(productId, { [fieldKey]: value })`.
 *     Uses the adapter's response `updatedAt` as the opaque `baseVersion` so
 *     future inbound reconciles can detect divergence by string inequality.
 *
 *   - **Channel path**: resolves an `OfferManager` adapter for the target
 *     connection, confirms it implements `OfferFieldUpdater`, walks the
 *     product's variants → `OfferMappingRepository.findMany` to collect the
 *     distinct `externalOfferId`s linked to the product on that connection,
 *     and issues one `updateOfferFields` call per distinct offer. The
 *     returned `baseVersion` is a synthetic publish timestamp — channel-side
 *     inbound reconcile does not exist yet (tracked as a follow-up); when it
 *     lands, the strategy here will need to be reconciled with the
 *     marketplace-provided revision / lastUpdated.
 *
 * The `ChannelContentPublishNotSupportedException` class remains in the
 * domain for future branches (e.g. a connection type that fundamentally
 * cannot receive content) but is no longer thrown on the default channel
 * path.
 *
 * @module libs/core/src/content/application/services
 * @implements {ContentPublisherPort}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import { INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import { IIntegrationsService } from '@openlinker/core/integrations';
import type { ProductMasterPort } from '@openlinker/core/products';
import {
  isOfferFieldUpdater,
  OFFER_MAPPINGS_SERVICE_TOKEN,
  type IOfferMappingsService,
  type OfferManagerPort,
} from '@openlinker/core/listings';
import { ChannelAdapterLacksFieldUpdaterException } from '../../domain/exceptions/channel-adapter-lacks-field-updater.exception';
import { ContentPublishMissingVersionException } from '../../domain/exceptions/content-publish-missing-version.exception';
import { NoLinkedOffersException } from '../../domain/exceptions/no-linked-offers.exception';
import { NoProductMasterAdapterException } from '../../domain/exceptions/no-product-master-adapter.exception';
import type {
  ContentPublishRequest,
  ContentPublishResult,
  ContentPublisherPort,
} from '../../domain/ports/content-publisher.port';

// Channel description wrapping. Today's only channel is Allegro, whose
// description format is a `sections[].items[]` tree of `TEXT` blocks. We
// wrap the operator-supplied string as a single TEXT item inside a single
// section — a richer WYSIWYG story is deferred per issue #339.
function toChannelDescriptionPayload(value: string): {
  sections: Array<{ items: Array<{ type: 'TEXT'; content: string }> }>;
} {
  return { sections: [{ items: [{ type: 'TEXT', content: value }] }] };
}

@Injectable()
export class IntegrationsContentPublisher implements ContentPublisherPort {
  private readonly logger = new Logger(IntegrationsContentPublisher.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(OFFER_MAPPINGS_SERVICE_TOKEN)
    private readonly offerMappings: IOfferMappingsService
  ) {}

  async publish(request: ContentPublishRequest): Promise<ContentPublishResult> {
    if (request.connectionId === null) {
      return this.publishMaster(request);
    }
    return this.publishChannel(request, request.connectionId);
  }

  private async publishMaster(request: ContentPublishRequest): Promise<ContentPublishResult> {
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
          `Refine selection when multi-master is wired.`
      );
    }

    const { adapter } = masters[0];

    const updated = await adapter.updateProduct(request.productId, {
      [request.fieldKey]: request.value,
    });

    if (!updated.updatedAt) {
      throw new ContentPublishMissingVersionException(request.productId, request.fieldKey);
    }

    return { baseVersion: updated.updatedAt.toISOString() };
  }

  private async publishChannel(
    request: ContentPublishRequest,
    connectionId: string
  ): Promise<ContentPublishResult> {
    const adapter = await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
      connectionId,
      'OfferManager'
    );
    if (!isOfferFieldUpdater(adapter)) {
      throw new ChannelAdapterLacksFieldUpdaterException(
        request.productId,
        connectionId,
        request.fieldKey
      );
    }

    // Need the product's variants to discover linked offers. Channel publishing
    // uses the single ProductMaster adapter as a read source regardless of the
    // target channel — the variant set is master-scoped.
    const masters = await this.integrationsService.listCapabilityAdapters<ProductMasterPort>({
      capability: 'ProductMaster',
    });
    if (masters.length === 0) {
      throw new NoProductMasterAdapterException(request.productId, request.fieldKey);
    }
    const { adapter: productMaster } = masters[0];
    const variants = await productMaster.getProductVariants(request.productId);

    const externalOfferIds = new Set<string>();
    for (const variant of variants) {
      const page = await this.offerMappings.findForVariant(connectionId, variant.id);
      for (const mapping of page.items) {
        externalOfferIds.add(mapping.externalId);
      }
    }

    if (externalOfferIds.size === 0) {
      throw new NoLinkedOffersException(request.productId, connectionId);
    }

    const publishedAtIso = new Date().toISOString();
    const payload = toChannelDescriptionPayload(request.value);

    for (const externalOfferId of externalOfferIds) {
      await adapter.updateOfferFields({
        externalOfferId,
        fields: { description: payload },
        idempotencyKey: `content:${request.productId}:${connectionId}:${externalOfferId}:${publishedAtIso}`,
      });
    }

    this.logger.log(
      `[content] channel publish ok: productId=${request.productId} connectionId=${connectionId} ` +
        `fieldKey=${request.fieldKey} offers=${externalOfferIds.size} publishedAt=${publishedAtIso}`
    );

    // Synthetic baseVersion: the channel side has no inbound-reconcile pipeline
    // yet, so this timestamp is never compared against a marketplace revision.
    // When channel reconcile ships (separate issue), this strategy must be
    // replaced with the marketplace-provided revision to keep the optimistic
    // conflict model sound.
    return { baseVersion: publishedAtIso };
  }
}
