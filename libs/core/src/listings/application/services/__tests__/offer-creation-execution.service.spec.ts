/**
 * Offer Creation Execution Service Tests
 *
 * @module libs/core/src/listings/application/services/__tests__
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';

import {
  DuplicateIdentifierMappingError,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
} from '@openlinker/core/identifier-mapping';
import type { IIdentifierMappingService } from '@openlinker/core/identifier-mapping';
import { INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import { OfferCreateRejectedException } from '@openlinker/core/listings';
import type {
  OfferManagerPort,
  CreateOfferCommand,
  CreateOfferResult,
} from '@openlinker/core/listings';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import { Logger } from '@openlinker/shared/logging';

import { OfferCreationExecutionService } from '../offer-creation-execution.service';
import { OfferCreationRecord } from '../../../domain/entities/offer-creation-record.entity';
import { MasterCatalogConnectionNotConfiguredException } from '../../../domain/exceptions/master-catalog-connection-not-configured.exception';
import { OfferBuilderValidationException } from '../../../domain/exceptions/offer-builder-validation.exception';
import { OfferCreationInvariantException } from '../../../domain/exceptions/offer-creation-invariant.exception';
import { OfferCreationRecordNotFoundException } from '../../../domain/exceptions/offer-creation-record-not-found.exception';
import type { OfferCreationRecordRepositoryPort } from '../../../domain/ports/offer-creation-record-repository.port';
import {
  OFFER_BUILDER_SERVICE_TOKEN,
  OFFER_CREATION_RECORD_REPOSITORY_TOKEN,
  OFFER_STATUS_POLL_SERVICE_TOKEN,
} from '../../../listings.tokens';
import type { IOfferBuilderService } from '../../interfaces/offer-builder.service.interface';
import type { IOfferStatusPollService } from '../../interfaces/offer-status-poll.service.interface';

const VARIANT_ID = 'ol_variant_123';
const CONNECTION_ID = 'conn-allegro';
const EXTERNAL_OFFER_ID = 'allegro-offer-42';

describe('OfferCreationExecutionService', () => {
  let service: OfferCreationExecutionService;
  let builder: jest.Mocked<Pick<IOfferBuilderService, 'buildCreateOfferCommand'>>;
  let records: jest.Mocked<OfferCreationRecordRepositoryPort>;
  let identifierMapping: jest.Mocked<Pick<IIdentifierMappingService, 'createMapping'>>;
  let integrationsService: jest.Mocked<Pick<IIntegrationsService, 'getCapabilityAdapter'>>;
  let adapter: { createOffer: jest.Mock };
  let offerStatusPoll: jest.Mocked<IOfferStatusPollService>;

  const builtCommand: CreateOfferCommand = {
    internalVariantId: VARIANT_ID,
    connectionId: CONNECTION_ID,
    price: { amount: 49.99, currency: 'PLN' },
    stock: 3,
    publishImmediately: false,
  };

  const buildRecord = (overrides: Partial<OfferCreationRecord> = {}): OfferCreationRecord => {
    const now = new Date('2026-01-01T00:00:00Z');
    return new OfferCreationRecord(
      overrides.id ?? 'rec-1',
      overrides.internalVariantId ?? VARIANT_ID,
      overrides.connectionId ?? CONNECTION_ID,
      overrides.externalOfferId ?? null,
      overrides.status ?? 'pending',
      overrides.errors ?? null,
      overrides.publishImmediately ?? false,
      overrides.createdAt ?? now,
      overrides.updatedAt ?? now
    );
  };

  beforeEach(async () => {
    builder = {
      buildCreateOfferCommand: jest.fn().mockResolvedValue(builtCommand),
    };
    records = {
      create: jest.fn().mockResolvedValue(buildRecord()),
      findById: jest.fn(),
      findLatestByVariantAndConnection: jest.fn(),
      findByExternalOfferIdAndConnectionId: jest.fn(),
      updateStatus: jest
        .fn()
        .mockImplementation((id, status, errors) =>
          Promise.resolve(buildRecord({ id, status, errors: errors ?? null }))
        ),
      updateExternalOfferId: jest
        .fn()
        .mockImplementation((id, externalOfferId) =>
          Promise.resolve(buildRecord({ id, externalOfferId }))
        ),
      updateExternalIdAndStatus: jest
        .fn()
        .mockImplementation((id, externalOfferId, status, errors) =>
          Promise.resolve(buildRecord({ id, externalOfferId, status, errors: errors ?? null }))
        ),
      findByBulkBatchId: jest.fn(),
      updateClassificationReport: jest.fn(),
      resetForRetry: jest.fn(),
    };
    identifierMapping = {
      createMapping: jest.fn().mockResolvedValue(undefined),
    };
    adapter = {
      createOffer: jest.fn().mockResolvedValue({
        externalOfferId: EXTERNAL_OFFER_ID,
        status: 'draft',
      } satisfies CreateOfferResult),
    };
    integrationsService = {
      getCapabilityAdapter: jest.fn().mockResolvedValue(adapter as unknown as OfferManagerPort),
    };
    offerStatusPoll = {
      scheduleFirstPoll: jest.fn().mockResolvedValue(undefined),
      pollOnce: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OfferCreationExecutionService,
        { provide: OFFER_BUILDER_SERVICE_TOKEN, useValue: builder },
        { provide: OFFER_CREATION_RECORD_REPOSITORY_TOKEN, useValue: records },
        { provide: IDENTIFIER_MAPPING_SERVICE_TOKEN, useValue: identifierMapping },
        { provide: INTEGRATIONS_SERVICE_TOKEN, useValue: integrationsService },
        { provide: OFFER_STATUS_POLL_SERVICE_TOKEN, useValue: offerStatusPoll },
      ],
    }).compile();

    service = module.get(OfferCreationExecutionService);
  });

  const baseInput = {
    internalVariantId: VARIANT_ID,
    connectionId: CONNECTION_ID,
    stock: 3,
    publishImmediately: false,
  };

  it('creates record, builds command, calls adapter, maps identifier, and persists draft result', async () => {
    const { offerCreationRecord } = await service.executeCreation(baseInput);

    expect(records.create).toHaveBeenCalledWith({
      internalVariantId: VARIANT_ID,
      connectionId: CONNECTION_ID,
      status: 'pending',
      publishImmediately: false,
      externalOfferId: null,
      errors: null,
    });
    expect(builder.buildCreateOfferCommand).toHaveBeenCalledWith(
      expect.objectContaining({ internalVariantId: VARIANT_ID, connectionId: CONNECTION_ID })
    );
    expect(integrationsService.getCapabilityAdapter).toHaveBeenCalledWith(
      CONNECTION_ID,
      'OfferManager'
    );
    expect(adapter.createOffer).toHaveBeenCalledWith(builtCommand);
    expect(identifierMapping.createMapping).toHaveBeenCalledWith(
      'Offer',
      EXTERNAL_OFFER_ID,
      CONNECTION_ID,
      VARIANT_ID
    );
    expect(records.updateExternalIdAndStatus).toHaveBeenCalledWith(
      'rec-1',
      EXTERNAL_OFFER_ID,
      'draft',
      null
    );
    expect(records.updateExternalOfferId).not.toHaveBeenCalled();
    expect(records.updateStatus).not.toHaveBeenCalled();
    expect(offerCreationRecord.status).toBe('draft');
  });

  it('persists status=active when adapter returns active', async () => {
    adapter.createOffer.mockResolvedValueOnce({
      externalOfferId: EXTERNAL_OFFER_ID,
      status: 'active',
    });

    const { offerCreationRecord } = await service.executeCreation(baseInput);

    expect(records.updateExternalIdAndStatus).toHaveBeenCalledWith(
      'rec-1',
      EXTERNAL_OFFER_ID,
      'active',
      null
    );
    expect(offerCreationRecord.status).toBe('active');
  });

  // The pre-existing "logs a warning when the result is validating" test was
  // removed in #447: the TODO warn was replaced by `scheduleFirstPoll`, which
  // is covered by the "validating outcome → schedules poll" describe below.
  // The warn is now reserved for the failure-to-enqueue safety net.

  it('persists validation errors from a 2xx result', async () => {
    adapter.createOffer.mockResolvedValueOnce({
      externalOfferId: EXTERNAL_OFFER_ID,
      status: 'draft',
      validationErrors: [
        { field: 'parameters.EAN', code: 'VALIDATION_REQUIRED', message: 'Supply EAN' },
      ],
    });

    await service.executeCreation(baseInput);

    expect(records.updateExternalIdAndStatus).toHaveBeenCalledWith(
      'rec-1',
      EXTERNAL_OFFER_ID,
      'draft',
      [{ field: 'parameters.EAN', code: 'VALIDATION_REQUIRED', message: 'Supply EAN' }]
    );
  });

  it('marks record failed and resolves when builder raises OfferBuilderValidationException', async () => {
    builder.buildCreateOfferCommand.mockRejectedValueOnce(
      new OfferBuilderValidationException([
        { field: 'overrides.categoryId', code: 'REQUIRED', message: 'Category required' },
      ])
    );

    const { offerCreationRecord } = await service.executeCreation(baseInput);

    expect(records.updateStatus).toHaveBeenCalledWith('rec-1', 'failed', [
      { field: 'overrides.categoryId', code: 'REQUIRED', message: 'Category required' },
    ]);
    expect(adapter.createOffer).not.toHaveBeenCalled();
    expect(offerCreationRecord.status).toBe('failed');
  });

  it('marks record failed with synthetic error when master catalog is not configured', async () => {
    builder.buildCreateOfferCommand.mockRejectedValueOnce(
      new MasterCatalogConnectionNotConfiguredException(CONNECTION_ID)
    );

    await service.executeCreation(baseInput);

    expect(records.updateStatus).toHaveBeenCalledWith('rec-1', 'failed', [
      expect.objectContaining({
        field: 'connection.config.masterCatalogConnectionId',
        code: 'MASTER_CATALOG_NOT_CONFIGURED',
      }),
    ]);
    expect(adapter.createOffer).not.toHaveBeenCalled();
  });

  it('marks record failed and resolves when adapter raises OfferCreateRejectedException', async () => {
    adapter.createOffer.mockRejectedValueOnce(
      new OfferCreateRejectedException('allegro.publicapi.v1', 422, [
        { field: 'category.id', code: 'BAD_CATEGORY', message: 'Category does not exist' },
      ])
    );

    const { offerCreationRecord } = await service.executeCreation(baseInput);

    expect(records.updateStatus).toHaveBeenCalledWith('rec-1', 'failed', [
      { field: 'category.id', code: 'BAD_CATEGORY', message: 'Category does not exist' },
    ]);
    expect(identifierMapping.createMapping).not.toHaveBeenCalled();
    expect(offerCreationRecord.status).toBe('failed');
  });

  it('propagates unknown adapter errors to the caller', async () => {
    adapter.createOffer.mockRejectedValueOnce(new Error('timeout'));

    await expect(service.executeCreation(baseInput)).rejects.toThrow('timeout');
    expect(records.updateStatus).not.toHaveBeenCalled();
    expect(records.updateExternalIdAndStatus).not.toHaveBeenCalled();
  });

  it('throws when the resolved adapter does not support createOffer', async () => {
    integrationsService.getCapabilityAdapter.mockResolvedValueOnce(
      {} as unknown as OfferManagerPort
    );

    await expect(service.executeCreation(baseInput)).rejects.toThrow(
      /does not support Marketplace.createOffer/
    );
    expect(records.updateStatus).not.toHaveBeenCalled();
    expect(records.updateExternalIdAndStatus).not.toHaveBeenCalled();
  });

  it('swallows DuplicateIdentifierMappingError as idempotent success', async () => {
    identifierMapping.createMapping.mockRejectedValueOnce(
      new DuplicateIdentifierMappingError('Offer', EXTERNAL_OFFER_ID, 'allegro', CONNECTION_ID)
    );

    const { offerCreationRecord } = await service.executeCreation(baseInput);

    expect(records.updateExternalIdAndStatus).toHaveBeenCalledWith(
      'rec-1',
      EXTERNAL_OFFER_ID,
      'draft',
      null
    );
    expect(offerCreationRecord.status).toBe('draft');
  });

  it('uses the pre-existing record when offerCreationRecordId is provided', async () => {
    const existing = buildRecord({ id: 'rec-pre', status: 'pending' });
    records.findById.mockResolvedValueOnce(existing);

    await service.executeCreation({ ...baseInput, offerCreationRecordId: 'rec-pre' });

    expect(records.findById).toHaveBeenCalledWith('rec-pre');
    expect(records.create).not.toHaveBeenCalled();
    expect(records.updateExternalIdAndStatus).toHaveBeenCalledWith(
      'rec-pre',
      EXTERNAL_OFFER_ID,
      'draft',
      null
    );
  });

  it('throws OfferCreationRecordNotFoundException when provided record id does not exist', async () => {
    records.findById.mockResolvedValueOnce(null);

    await expect(
      service.executeCreation({ ...baseInput, offerCreationRecordId: 'missing' })
    ).rejects.toBeInstanceOf(OfferCreationRecordNotFoundException);
    expect(records.create).not.toHaveBeenCalled();
  });

  it('propagates non-duplicate errors from identifier mapping', async () => {
    identifierMapping.createMapping.mockRejectedValueOnce(new Error('redis down'));

    await expect(service.executeCreation(baseInput)).rejects.toThrow('redis down');
    expect(records.updateExternalIdAndStatus).not.toHaveBeenCalled();
  });

  it('threads price, publishImmediately, overrides, and idempotencyKey to the builder', async () => {
    const overrides = { title: 'Custom', categoryId: 'cat-1' };
    await service.executeCreation({
      ...baseInput,
      publishImmediately: true,
      price: { amount: 99.5, currency: 'EUR' },
      overrides,
      idempotencyKey: 'idem-1',
    });

    expect(builder.buildCreateOfferCommand).toHaveBeenCalledWith({
      internalVariantId: VARIANT_ID,
      connectionId: CONNECTION_ID,
      stock: 3,
      publishImmediately: true,
      price: { amount: 99.5, currency: 'EUR' },
      overrides,
      idempotencyKey: 'idem-1',
    });
  });

  // Issue #400 — Plan B for #391: outcome derivation on the result.
  describe('outcome derivation', () => {
    it('returns outcome=ok when adapter persists status=draft', async () => {
      adapter.createOffer.mockResolvedValueOnce({
        externalOfferId: EXTERNAL_OFFER_ID,
        status: 'draft',
      } satisfies CreateOfferResult);

      const result = await service.executeCreation(baseInput);

      expect(result.outcome).toBe('ok');
      expect(result.offerCreationRecord.status).toBe('draft');
    });

    it('returns outcome=ok when adapter persists status=active', async () => {
      adapter.createOffer.mockResolvedValueOnce({
        externalOfferId: EXTERNAL_OFFER_ID,
        status: 'active',
      } satisfies CreateOfferResult);

      const result = await service.executeCreation(baseInput);

      expect(result.outcome).toBe('ok');
    });

    it('returns outcome=ok when adapter returns validating (poll handler will resolve later)', async () => {
      adapter.createOffer.mockResolvedValueOnce({
        externalOfferId: EXTERNAL_OFFER_ID,
        status: 'validating',
      } satisfies CreateOfferResult);

      const result = await service.executeCreation(baseInput);

      expect(result.outcome).toBe('ok');
    });

    it('returns outcome=business_failure when builder validation fails', async () => {
      builder.buildCreateOfferCommand.mockRejectedValueOnce(
        new OfferBuilderValidationException([
          { field: 'price.amount', code: 'REQUIRED', message: 'Required' },
        ])
      );

      const result = await service.executeCreation(baseInput);

      expect(result.outcome).toBe('business_failure');
      expect(result.offerCreationRecord.status).toBe('failed');
    });

    it('returns outcome=business_failure when master catalog is misconfigured', async () => {
      builder.buildCreateOfferCommand.mockRejectedValueOnce(
        new MasterCatalogConnectionNotConfiguredException(CONNECTION_ID)
      );

      const result = await service.executeCreation(baseInput);

      expect(result.outcome).toBe('business_failure');
    });

    it('returns outcome=business_failure when the adapter rejects with OfferCreateRejectedException', async () => {
      adapter.createOffer.mockRejectedValueOnce(
        new OfferCreateRejectedException('allegro.publicapi.v1', 422, [
          { field: 'category', code: 'INVALID', message: 'Unknown category' },
        ])
      );

      const result = await service.executeCreation(baseInput);

      expect(result.outcome).toBe('business_failure');
    });

    it('logs a warn line on the business_failure branch', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      adapter.createOffer.mockRejectedValueOnce(
        new OfferCreateRejectedException('allegro.publicapi.v1', 422, [
          { field: 'category', code: 'INVALID', message: 'Unknown category' },
        ])
      );

      await service.executeCreation(baseInput);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('business_failure'));
      warnSpy.mockRestore();
    });

    it('throws OfferCreationInvariantException when the record stays in pending after the flow', async () => {
      // Return shape never normally occurs — but defensively: the orchestrator should
      // fail loudly rather than silently mislabel a pending record as ok.
      adapter.createOffer.mockResolvedValueOnce({
        externalOfferId: EXTERNAL_OFFER_ID,
        status: 'active',
      } satisfies CreateOfferResult);
      records.updateExternalIdAndStatus.mockResolvedValueOnce(buildRecord({ status: 'pending' }));

      await expect(service.executeCreation(baseInput)).rejects.toBeInstanceOf(
        OfferCreationInvariantException
      );
    });
  });

  describe('validating outcome → schedules poll (#447)', () => {
    it('schedules iteration #1 with recordId, externalOfferId, connectionId', async () => {
      adapter.createOffer.mockResolvedValueOnce({
        externalOfferId: EXTERNAL_OFFER_ID,
        status: 'validating',
      } satisfies CreateOfferResult);
      records.updateExternalIdAndStatus.mockResolvedValueOnce(
        buildRecord({ id: 'rec-1', status: 'validating', externalOfferId: EXTERNAL_OFFER_ID })
      );

      await service.executeCreation(baseInput);

      expect(offerStatusPoll.scheduleFirstPoll).toHaveBeenCalledWith({
        offerCreationRecordId: 'rec-1',
        externalOfferId: EXTERNAL_OFFER_ID,
        connectionId: CONNECTION_ID,
      });
    });

    it('does not schedule when status is terminal (active/draft/failed)', async () => {
      adapter.createOffer.mockResolvedValueOnce({
        externalOfferId: EXTERNAL_OFFER_ID,
        status: 'active',
      } satisfies CreateOfferResult);

      await service.executeCreation(baseInput);

      expect(offerStatusPoll.scheduleFirstPoll).not.toHaveBeenCalled();
    });

    it('logs a warning but does not fail the create flow if scheduleFirstPoll throws', async () => {
      adapter.createOffer.mockResolvedValueOnce({
        externalOfferId: EXTERNAL_OFFER_ID,
        status: 'validating',
      } satisfies CreateOfferResult);
      records.updateExternalIdAndStatus.mockResolvedValueOnce(
        buildRecord({ id: 'rec-1', status: 'validating', externalOfferId: EXTERNAL_OFFER_ID })
      );
      offerStatusPoll.scheduleFirstPoll.mockRejectedValueOnce(new Error('redis down'));
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      // Must resolve normally — the offer was already created on Allegro.
      const result = await service.executeCreation(baseInput);

      expect(result.outcome).toBe('ok');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('failed to schedule poll'));
      warnSpy.mockRestore();
    });
  });

  describe('Smart classification readback (#737)', () => {
    it('reads and persists Smart report when adapter implements the capability and status=active', async () => {
      const report = { fulfilled: true, conditions: [] };
      const smartAdapter = {
        createOffer: jest.fn().mockResolvedValue({
          externalOfferId: EXTERNAL_OFFER_ID,
          status: 'active',
        } satisfies CreateOfferResult),
        getOfferSmartClassification: jest.fn().mockResolvedValue(report),
      };
      integrationsService.getCapabilityAdapter.mockResolvedValueOnce(
        smartAdapter as unknown as OfferManagerPort
      );
      records.updateExternalIdAndStatus.mockResolvedValueOnce(
        buildRecord({ status: 'active', externalOfferId: EXTERNAL_OFFER_ID })
      );

      await service.executeCreation(baseInput);

      expect(smartAdapter.getOfferSmartClassification).toHaveBeenCalledWith(EXTERNAL_OFFER_ID);
      expect(records.updateClassificationReport).toHaveBeenCalledWith('rec-1', report);
    });

    it('persists null when Smart readback throws (best-effort, AC-7)', async () => {
      const smartAdapter = {
        createOffer: jest.fn().mockResolvedValue({
          externalOfferId: EXTERNAL_OFFER_ID,
          status: 'active',
        } satisfies CreateOfferResult),
        getOfferSmartClassification: jest.fn().mockRejectedValue(new Error('Allegro 500')),
      };
      integrationsService.getCapabilityAdapter.mockResolvedValueOnce(
        smartAdapter as unknown as OfferManagerPort
      );
      records.updateExternalIdAndStatus.mockResolvedValueOnce(
        buildRecord({ status: 'active', externalOfferId: EXTERNAL_OFFER_ID })
      );

      const result = await service.executeCreation(baseInput);

      expect(result.outcome).toBe('ok');
      expect(records.updateClassificationReport).toHaveBeenCalledWith('rec-1', null);
    });

    it('skips Smart readback when status=validating (poll-service handles it)', async () => {
      const smartAdapter = {
        createOffer: jest.fn().mockResolvedValue({
          externalOfferId: EXTERNAL_OFFER_ID,
          status: 'validating',
        } satisfies CreateOfferResult),
        getOfferSmartClassification: jest.fn(),
      };
      integrationsService.getCapabilityAdapter.mockResolvedValueOnce(
        smartAdapter as unknown as OfferManagerPort
      );
      records.updateExternalIdAndStatus.mockResolvedValueOnce(
        buildRecord({ status: 'validating', externalOfferId: EXTERNAL_OFFER_ID })
      );

      await service.executeCreation(baseInput);

      expect(smartAdapter.getOfferSmartClassification).not.toHaveBeenCalled();
      expect(records.updateClassificationReport).not.toHaveBeenCalled();
    });

    it('skips Smart readback when status=draft', async () => {
      const smartAdapter = {
        createOffer: jest.fn().mockResolvedValue({
          externalOfferId: EXTERNAL_OFFER_ID,
          status: 'draft',
        } satisfies CreateOfferResult),
        getOfferSmartClassification: jest.fn(),
      };
      integrationsService.getCapabilityAdapter.mockResolvedValueOnce(
        smartAdapter as unknown as OfferManagerPort
      );

      await service.executeCreation(baseInput);

      expect(smartAdapter.getOfferSmartClassification).not.toHaveBeenCalled();
      expect(records.updateClassificationReport).not.toHaveBeenCalled();
    });

    it('skips Smart readback when adapter does not implement the capability', async () => {
      // The default `adapter` fixture has only `createOffer` — no
      // getOfferSmartClassification — so isOfferSmartClassificationReader is false.
      adapter.createOffer.mockResolvedValueOnce({
        externalOfferId: EXTERNAL_OFFER_ID,
        status: 'active',
      });
      records.updateExternalIdAndStatus.mockResolvedValueOnce(
        buildRecord({ status: 'active', externalOfferId: EXTERNAL_OFFER_ID })
      );

      await service.executeCreation(baseInput);

      expect(records.updateClassificationReport).not.toHaveBeenCalled();
    });
  });
});
