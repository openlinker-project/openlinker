/**
 * Offer Creation Execution Service
 *
 * Owns the orchestration policy for creating a marketplace offer outbound
 * (OL → Allegro / WooCommerce / eBay). The `marketplace.offer.create` worker
 * handler and the future REST endpoint (#259) both delegate to this service
 * so that create semantics stay in one place (per `architecture-overview.md`
 * §6 — "Sync orchestration policies live in core application services").
 *
 * Flow:
 *   1. Load or create the OfferCreationRecord.
 *   2. Build the neutral CreateOfferCommand (OfferBuilderService).
 *   3. Resolve the marketplace adapter and call `createOffer`.
 *   4. Persist the IdentifierMapping (idempotent on retry).
 *   5. Update the record with externalOfferId + final status.
 *
 * Terminal domain failures (builder validation, master-catalog misconfig,
 * platform reject) are caught and recorded as `status='failed'`. The method
 * resolves normally in those cases so the worker runner treats the job as
 * succeeded and does not retry. Transient / unknown errors propagate.
 *
 * @module libs/core/src/listings/application/services
 * @implements {IOfferCreationExecutionService}
 */

import { Inject, Injectable } from '@nestjs/common';

import {
  DuplicateIdentifierMappingError,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  IIdentifierMappingService,
} from '@openlinker/core/identifier-mapping';
import { OfferManagerPort, isOfferCreator } from '@openlinker/core/listings';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import { CreateOfferCommand, CreateOfferResult, CreateOfferValidationError, OfferCreateRejectedException } from '@openlinker/core/listings';
import type { JobOutcome } from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

import { OfferCreationRecord } from '../../domain/entities/offer-creation-record.entity';
import { MasterCatalogConnectionNotConfiguredException } from '../../domain/exceptions/master-catalog-connection-not-configured.exception';
import {
  OfferBuilderValidationException,
  OfferBuilderValidationIssue,
} from '../../domain/exceptions/offer-builder-validation.exception';
import { OfferCreationInvariantException } from '../../domain/exceptions/offer-creation-invariant.exception';
import { OfferCreationRecordNotFoundException } from '../../domain/exceptions/offer-creation-record-not-found.exception';
import { OfferCreationRecordRepositoryPort } from '../../domain/ports/offer-creation-record-repository.port';
import { OfferCreationError } from '../../domain/types/offer-creation-record.types';
import {
  ExecuteOfferCreationInput,
  ExecuteOfferCreationResult,
} from '../types/offer-creation-execution.types';
import {
  OFFER_BUILDER_SERVICE_TOKEN,
  OFFER_CREATION_RECORD_REPOSITORY_TOKEN,
  OFFER_STATUS_POLL_SERVICE_TOKEN,
} from '../../listings.tokens';
import { IOfferBuilderService } from '../interfaces/offer-builder.service.interface';
import { IOfferCreationExecutionService } from '../interfaces/offer-creation-execution.service.interface';
import { IOfferStatusPollService } from '../interfaces/offer-status-poll.service.interface';

@Injectable()
export class OfferCreationExecutionService implements IOfferCreationExecutionService {
  private readonly logger = new Logger(OfferCreationExecutionService.name);

  constructor(
    @Inject(OFFER_BUILDER_SERVICE_TOKEN)
    private readonly offerBuilder: IOfferBuilderService,
    @Inject(OFFER_CREATION_RECORD_REPOSITORY_TOKEN)
    private readonly offerCreationRecords: OfferCreationRecordRepositoryPort,
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IIdentifierMappingService,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(OFFER_STATUS_POLL_SERVICE_TOKEN)
    private readonly offerStatusPoll: IOfferStatusPollService,
  ) {}

  async executeCreation(input: ExecuteOfferCreationInput): Promise<ExecuteOfferCreationResult> {
    const record = await this.loadOrCreateRecord(input);

    let command: CreateOfferCommand;
    try {
      command = await this.offerBuilder.buildCreateOfferCommand({
        internalVariantId: input.internalVariantId,
        connectionId: input.connectionId,
        stock: input.stock,
        publishImmediately: input.publishImmediately,
        price: input.price,
        overrides: input.overrides,
        idempotencyKey: input.idempotencyKey,
      });
    } catch (error) {
      const terminal = this.mapBuilderException(error);
      if (terminal) {
        const updated = await this.offerCreationRecords.updateStatus(record.id, 'failed', terminal);
        return this.buildResult(updated, input.connectionId);
      }
      throw error;
    }

    const adapter = await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
      input.connectionId,
      'OfferManager',
    );
    if (!isOfferCreator(adapter)) {
      throw new Error(
        `Adapter for connection ${input.connectionId} does not support Marketplace.createOffer`,
      );
    }

    let result: CreateOfferResult;
    try {
      result = await adapter.createOffer(command);
    } catch (error) {
      if (error instanceof OfferCreateRejectedException) {
        const updated = await this.offerCreationRecords.updateStatus(
          record.id,
          'failed',
          this.mapRejectionErrors(error),
        );
        return this.buildResult(updated, input.connectionId);
      }
      throw error;
    }

    try {
      await this.identifierMapping.createMapping(
        'Offer',
        result.externalOfferId,
        input.connectionId,
        input.internalVariantId,
      );
    } catch (error) {
      if (!(error instanceof DuplicateIdentifierMappingError)) {
        throw error;
      }
      // Idempotent retry: the mapping was already inserted on a prior attempt.
      // createMapping's `externalId → internalId` is exactly what we wanted, so continue.
    }

    const persistedErrors = this.mapResultValidationErrors(result.validationErrors);
    const finalRecord = await this.offerCreationRecords.updateExternalIdAndStatus(
      record.id,
      result.externalOfferId,
      result.status,
      persistedErrors,
    );

    if (finalRecord.status === 'validating') {
      try {
        await this.offerStatusPoll.scheduleFirstPoll({
          offerCreationRecordId: finalRecord.id,
          externalOfferId: result.externalOfferId,
          connectionId: input.connectionId,
        });
      } catch (err) {
        // Enqueue failure is non-fatal for the create flow — the offer was
        // already created on Allegro and the record is persisted. Log so an
        // operator can manually trigger a retry from the FE if needed.
        this.logger.warn(
          `Offer created but failed to schedule poll iteration #1 — record will stay 'validating' until an operator retries. recordId=${finalRecord.id} externalOfferId=${result.externalOfferId} connectionId=${input.connectionId} error=${(err as Error).message}`,
        );
      }
    }

    return this.buildResult(finalRecord, input.connectionId);
  }

  /**
   * Map an `OfferCreationRecord` to its corresponding `JobOutcome`.
   *
   * Domain semantics — kept here (rather than in the worker handler) so the
   * future REST entrypoint (#259) gets the same mapping for free.
   *
   * - `'failed'` → `'business_failure'` (terminal rejection by marketplace,
   *   builder, or master-catalog config — not retryable; operator action).
   * - `'active' | 'draft' | 'validating'` → `'ok'` (the create operation
   *   itself succeeded; any subsequent async transitions are tracked on the
   *   record, not the job — see issue #400 risk #4).
   * - `'pending'` → invariant violation (see {@link OfferCreationInvariantException}).
   */
  private recordToOutcome(record: OfferCreationRecord): JobOutcome {
    switch (record.status) {
      case 'failed':
        return 'business_failure';
      case 'active':
      case 'draft':
      case 'validating':
        return 'ok';
      case 'pending':
        throw new OfferCreationInvariantException(record.id, record.status);
    }
  }

  private buildResult(
    record: OfferCreationRecord,
    connectionId: string,
  ): ExecuteOfferCreationResult {
    const outcome = this.recordToOutcome(record);
    if (outcome === 'business_failure') {
      this.logger.warn(
        `Offer creation recorded business_failure. recordId=${record.id} connectionId=${connectionId} errorCount=${record.errors?.length ?? 0}`,
      );
    }
    return { offerCreationRecord: record, outcome };
  }

  private async loadOrCreateRecord(
    input: ExecuteOfferCreationInput,
  ): Promise<OfferCreationRecord> {
    if (input.offerCreationRecordId) {
      const existing = await this.offerCreationRecords.findById(input.offerCreationRecordId);
      if (!existing) {
        throw new OfferCreationRecordNotFoundException(input.offerCreationRecordId);
      }
      return existing;
    }
    return this.offerCreationRecords.create({
      internalVariantId: input.internalVariantId,
      connectionId: input.connectionId,
      status: 'pending',
      publishImmediately: input.publishImmediately,
      externalOfferId: null,
      errors: null,
    });
  }

  private mapBuilderException(error: unknown): OfferCreationError[] | null {
    if (error instanceof OfferBuilderValidationException) {
      return error.issues.map((issue: OfferBuilderValidationIssue) => ({
        field: issue.field,
        code: issue.code,
        message: issue.message,
      }));
    }
    if (error instanceof MasterCatalogConnectionNotConfiguredException) {
      return [
        {
          field: 'connection.config.masterCatalogConnectionId',
          code: 'MASTER_CATALOG_NOT_CONFIGURED',
          message: error.message,
        },
      ];
    }
    return null;
  }

  private mapRejectionErrors(error: OfferCreateRejectedException): OfferCreationError[] {
    return error.errors.map((e) => ({
      field: e.field,
      code: e.code,
      message: e.message,
    }));
  }

  private mapResultValidationErrors(
    errors: CreateOfferValidationError[] | undefined,
  ): OfferCreationError[] | null {
    if (!errors || errors.length === 0) {
      return null;
    }
    return errors.map((e) => ({
      field: e.field,
      code: e.code,
      message: e.message,
    }));
  }
}
