/**
 * Offer Creation Enqueue Service
 *
 * Pre-enqueue orchestration for outbound offer creation: resolves adapter,
 * checks `createOffer` support, pre-creates the `OfferCreationRecord`, and
 * enqueues the `marketplace.offer.create` sync job. Used by the HTTP
 * controller (#259) so the controller stays thin.
 *
 * Post-enqueue orchestration (adapter call + mapping persistence + status
 * update) lives in the sibling `OfferCreationExecutionService`, invoked by
 * the worker handler.
 *
 * @module libs/core/src/listings/application/services
 * @implements {IOfferCreationEnqueueService}
 * @see {@link IOfferCreationEnqueueService} for the service contract
 * @see {@link OfferCreationExecutionService} for the post-enqueue half
 */

import { Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';

import { OfferManagerPort } from '@openlinker/core/listings';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import {
  JobEnqueuePort,
  JOB_ENQUEUE_TOKEN,
  type MarketplaceOfferCreatePayloadV1,
} from '@openlinker/core/sync';

import { OfferCreationRecordRepositoryPort } from '../../domain/ports/offer-creation-record-repository.port';
import {
  OFFER_CREATION_REQUEST_SNAPSHOT_SCHEMA_VERSION,
  type OfferCreationRequestSnapshot,
} from '../../domain/types/offer-creation-request-snapshot.types';
import { OFFER_CREATION_RECORD_REPOSITORY_TOKEN } from '../../listings.tokens';
import { IOfferCreationEnqueueService } from '../interfaces/offer-creation-enqueue.service.interface';
import type {
  EnqueueOfferCreationInput,
  EnqueueOfferCreationResult,
} from '../types/offer-creation-enqueue.types';

@Injectable()
export class OfferCreationEnqueueService implements IOfferCreationEnqueueService {
  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(OFFER_CREATION_RECORD_REPOSITORY_TOKEN)
    private readonly offerCreationRecords: OfferCreationRecordRepositoryPort,
    @Inject(JOB_ENQUEUE_TOKEN)
    private readonly jobEnqueue: JobEnqueuePort,
  ) {}

  async enqueueCreation(input: EnqueueOfferCreationInput): Promise<EnqueueOfferCreationResult> {
    // 1. Resolve the adapter. getCapabilityAdapter handles the connection
    //    existence / status / capability cascade and surfaces the right
    //    exception for each failure mode.
    const adapter = await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
      input.connectionId,
      'OfferManager',
    );

    // 2. `Marketplace` is supported, but `createOffer` is an optional
    //    sub-capability. Distinct 422 so clients can distinguish
    //    "unknown connection" from "this adapter reads but can't create".
    if (!adapter.createOffer) {
      throw new UnprocessableEntityException(
        `Adapter for connection ${input.connectionId} does not support offer creation`,
      );
    }

    // 3. Capture a snapshot of the request payload so a failed record can be
    //    re-opened in the wizard pre-filled. Schema-versioned so a future
    //    wire-shape change can ship a `v2` mapper without breaking readers of
    //    old records (#307).
    const requestSnapshot: OfferCreationRequestSnapshot = {
      schemaVersion: OFFER_CREATION_REQUEST_SNAPSHOT_SCHEMA_VERSION,
      internalVariantId: input.internalVariantId,
      stock: input.stock,
      publishImmediately: input.publishImmediately,
      ...(input.price !== undefined && { price: input.price }),
      ...(input.overrides !== undefined && { overrides: input.overrides }),
    };

    // 4. Pre-create the record so the HTTP response carries an id clients
    //    can poll immediately.
    const record = await this.offerCreationRecords.create({
      internalVariantId: input.internalVariantId,
      connectionId: input.connectionId,
      externalOfferId: null,
      status: 'pending',
      errors: null,
      publishImmediately: input.publishImmediately,
      request: requestSnapshot,
    });

    // 5. Enqueue. Default idempotency key is per-call-unique (the fresh
    //    record id) — a client that wants cross-retry dedupe passes
    //    `input.idempotencyKey`.
    const payload = {
      schemaVersion: 1 as const,
      internalVariantId: input.internalVariantId,
      stock: input.stock,
      publishImmediately: input.publishImmediately,
      offerCreationRecordId: record.id,
      ...(input.price !== undefined && { price: input.price }),
      ...(input.overrides !== undefined && { overrides: input.overrides }),
    } satisfies MarketplaceOfferCreatePayloadV1;

    const { jobId } = await this.jobEnqueue.enqueueJob({
      jobType: 'marketplace.offer.create',
      connectionId: input.connectionId,
      idempotencyKey: input.idempotencyKey ?? `offer-create:${record.id}`,
      payload,
    });

    return { jobId, offerCreationRecord: record };
  }
}
