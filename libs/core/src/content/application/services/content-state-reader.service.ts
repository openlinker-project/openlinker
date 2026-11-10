/**
 * Content State Reader Service
 *
 * Centralises the "read the editor state for a product" orchestration:
 * joins persisted draft/base rows with live adapter discovery (active
 * connections supporting `OfferFieldUpdater`) and a single batched offer-
 * mapping count per connection. Keeps the controller thin and prevents
 * drift between the read endpoint and `IntegrationsContentPublisher`
 * (which applies the same eligibility rules when publishing).
 *
 * Variant ids come from OpenLinker's own catalogue, not from a live master
 * (#4068). Failure semantics: read failures from the channel adapters
 * propagate — `getState` is operator-facing, and silently dropping
 * channels on an adapter outage would mask a real problem.
 *
 * @module libs/core/src/content/application/services
 * @implements {IContentStateReaderService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import { IIntegrationsService } from '@openlinker/core/integrations';
import {
  isOfferFieldUpdater,
  OFFER_MAPPINGS_SERVICE_TOKEN,
  type IOfferMappingsService,
  type OfferManagerPort,
} from '@openlinker/core/listings';
import { PRODUCTS_SERVICE_TOKEN, type IProductsService } from '@openlinker/core/products';
import { PRODUCT_CONTENT_FIELD_REPOSITORY_TOKEN } from '../../content.tokens';
import type { ProductContentField } from '../../domain/entities/product-content-field.entity';
import { ProductContentFieldRepositoryPort } from '../../domain/ports/product-content-field-repository.port';
import type { FieldKey } from '../../domain/types/content.types';
import type {
  ContentChannelState,
  ContentMasterState,
  ContentState,
} from '../types/content-state.types';
import type { IContentStateReaderService } from './content-state-reader.service.interface';

const DESCRIPTION_KEY: FieldKey = 'description';

@Injectable()
export class ContentStateReaderService implements IContentStateReaderService {
  constructor(
    @Inject(PRODUCT_CONTENT_FIELD_REPOSITORY_TOKEN)
    private readonly repository: ProductContentFieldRepositoryPort,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
    @Inject(OFFER_MAPPINGS_SERVICE_TOKEN)
    private readonly offerMappings: IOfferMappingsService,
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly products: IProductsService
  ) {}

  async readState(productId: string): Promise<ContentState> {
    const rows = await this.repository.findByProduct(productId, DESCRIPTION_KEY);
    const master = rows.find((row) => row.connectionId === null) ?? null;
    const channelRowsById = new Map<string, ProductContentField>();
    for (const row of rows) {
      if (row.connectionId !== null) channelRowsById.set(row.connectionId, row);
    }

    const variants = await this.loadVariantIds(productId);
    const offerManagers = await this.integrations.listCapabilityAdapters<OfferManagerPort>({
      capability: 'OfferManager',
    });

    const channels: ContentChannelState[] = [];
    for (const entry of offerManagers) {
      if (entry.connection.status !== 'active') continue;
      if (!isOfferFieldUpdater(entry.adapter)) continue;

      let linkedOfferCount = 0;
      if (variants.length > 0) {
        const counts = await this.offerMappings.countForVariants(entry.connectionId, variants);
        for (const count of counts.values()) {
          linkedOfferCount += count;
        }
      }
      if (linkedOfferCount === 0) continue;

      channels.push(
        toChannelState(
          entry.connectionId,
          entry.connection,
          channelRowsById.get(entry.connectionId),
          linkedOfferCount
        )
      );
    }

    channels.sort(
      (a, b) =>
        a.connectionName.localeCompare(b.connectionName) ||
        a.connectionId.localeCompare(b.connectionId)
    );

    return {
      productId,
      master: toMasterState(master),
      channels,
    };
  }

  /**
   * The product's variant ids, from OpenLinker's own catalogue (#4068). The
   * editor only needs them to count offer mappings per channel, which is
   * OpenLinker data too - asking the live master meant asking the FIRST master,
   * so with two (PrestaShop + Shoper) a Shoper product was looked up in
   * PrestaShop and the whole read failed.
   */
  private async loadVariantIds(productId: string): Promise<string[]> {
    const variants = await this.products.getVariantsByProductId(productId);
    return variants.map((v) => v.id);
  }
}

function toMasterState(row: ProductContentField | null): ContentMasterState {
  return {
    baseValue: row?.baseValue ?? null,
    draftValue: row?.draftValue ?? null,
    hasConflict: row?.hasConflict ?? false,
    updatedAt: row?.updatedAt.toISOString() ?? null,
    updatedBy: row?.updatedBy ?? null,
  };
}

function toChannelState(
  connectionId: string,
  connection: { name: string; platformType: string; status: string },
  row: ProductContentField | undefined,
  linkedOfferCount: number
): ContentChannelState {
  return {
    connectionId,
    connectionName: connection.name,
    platformType: connection.platformType,
    connectionStatus: connection.status,
    baseValue: row?.baseValue ?? null,
    draftValue: row?.draftValue ?? null,
    hasConflict: row?.hasConflict ?? false,
    updatedAt: row?.updatedAt.toISOString() ?? null,
    updatedBy: row?.updatedBy ?? null,
    linkedOfferCount,
  };
}
