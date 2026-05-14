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
 * Failure semantics: read failures from the ProductMaster adapter
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
  OFFER_MAPPING_REPOSITORY_TOKEN,
  type OfferManagerPort,
  type OfferMappingRepositoryPort,
} from '@openlinker/core/listings';
import type { ProductMasterPort } from '@openlinker/core/products';
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
    @Inject(OFFER_MAPPING_REPOSITORY_TOKEN)
    private readonly offerMappings: OfferMappingRepositoryPort
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
        const counts = await this.offerMappings.countByConnectionAndVariants(
          entry.connectionId,
          variants
        );
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

  private async loadVariantIds(productId: string): Promise<string[]> {
    const masters = await this.integrations.listCapabilityAdapters<ProductMasterPort>({
      capability: 'ProductMaster',
    });
    if (masters.length === 0) return [];
    const { adapter } = masters[0];
    const variants = await adapter.getProductVariants(productId);
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
