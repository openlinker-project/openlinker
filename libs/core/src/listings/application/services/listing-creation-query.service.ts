/**
 * Listing Creation Query Service
 *
 * Read-side service for `ListingCreationRecord` (#1044): the shop-publish
 * status-polling endpoint reads through this rather than touching the
 * repository port directly. Thin by design — the write lifecycle lives in the
 * enqueue (#1044) and execution (#1042) services.
 *
 * @module libs/core/src/listings/application/services
 * @implements {IListingCreationQueryService}
 */

import { Inject, Injectable } from '@nestjs/common';

import type { ListingCreationRecord } from '../../domain/entities/listing-creation-record.entity';
import { ListingCreationRecordRepositoryPort } from '../../domain/ports/listing-creation-record-repository.port';
import { LISTING_CREATION_RECORD_REPOSITORY_TOKEN } from '../../listings.tokens';
import type { IListingCreationQueryService } from '../interfaces/listing-creation-query.service.interface';

@Injectable()
export class ListingCreationQueryService implements IListingCreationQueryService {
  constructor(
    @Inject(LISTING_CREATION_RECORD_REPOSITORY_TOKEN)
    private readonly listingRecords: ListingCreationRecordRepositoryPort,
  ) {}

  getById(recordId: string): Promise<ListingCreationRecord | null> {
    return this.listingRecords.findById(recordId);
  }
}
