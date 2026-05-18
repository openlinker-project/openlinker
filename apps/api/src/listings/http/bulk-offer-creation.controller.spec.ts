/**
 * Bulk Offer Creation Controller Tests (#736)
 *
 * Verifies routing, status codes, DTO → service-input mapping, and
 * error → HTTP mapping for `POST /listings/bulk-create` and
 * `GET /listings/bulk-create/:batchId`. Mocks the
 * `IBulkOfferCreationSubmitService` token; per-product flow + Redis are
 * covered by the int-spec.
 *
 * @module apps/api/src/listings/http
 */
import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';

import {
  AdapterCapabilityNotSupportedException,
  BULK_OFFER_CREATION_RETRY_SERVICE_TOKEN,
  BULK_OFFER_CREATION_SUBMIT_SERVICE_TOKEN,
  BulkOfferCreationBatch,
  BulkOfferCreationBatchNotFoundException,
  BulkRetryMissingSnapshotException,
  EmptyBulkSubmissionException,
  NoFailedChildrenToRetryException,
} from '@openlinker/core/listings';
import type {
  IBulkOfferCreationRetryService,
  IBulkOfferCreationSubmitService,
  OfferCreationRecord,
} from '@openlinker/core/listings';

import { BulkOfferCreationController } from './bulk-offer-creation.controller';
import type { BulkOfferCreateRequestDto } from './dto/bulk-offer-create.dto';
import type { AuthenticatedUser } from '../../auth/auth.types';

describe('BulkOfferCreationController', () => {
  let controller: BulkOfferCreationController;
  let bulkSubmit: jest.Mocked<IBulkOfferCreationSubmitService>;
  let bulkRetry: jest.Mocked<IBulkOfferCreationRetryService>;

  const adminUser: AuthenticatedUser = {
    id: 'user-admin',
    username: 'admin',
    role: 'admin',
  } as AuthenticatedUser;

  beforeEach(async () => {
    bulkSubmit = {
      submit: jest.fn(),
      getBatch: jest.fn(),
    };
    bulkRetry = {
      retryFailed: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BulkOfferCreationController],
      providers: [
        { provide: BULK_OFFER_CREATION_SUBMIT_SERVICE_TOKEN, useValue: bulkSubmit },
        { provide: BULK_OFFER_CREATION_RETRY_SERVICE_TOKEN, useValue: bulkRetry },
      ],
    }).compile();

    controller = module.get<BulkOfferCreationController>(BulkOfferCreationController);
  });

  describe('POST /listings/bulk-create', () => {
    it('stamps initiatedBy from the session and forwards the typed input to the service', async () => {
      bulkSubmit.submit.mockResolvedValue({
        batchId: 'b-1',
        jobIds: ['job-1', 'job-2'],
      });

      const dto: BulkOfferCreateRequestDto = {
        connectionId: '00000000-0000-4000-8000-000000000000',
        productIds: ['v-a', 'v-b'],
        sharedConfig: {
          stock: 5,
          publishImmediately: false,
          price: { amount: 10, currency: 'PLN' },
          generateDescription: true,
          descriptionTone: 'concise',
        },
      };

      const response = await controller.submit(dto, adminUser);

      expect(response).toEqual({ batchId: 'b-1', jobIds: ['job-1', 'job-2'] });
      expect(bulkSubmit.submit).toHaveBeenCalledWith({
        connectionId: dto.connectionId,
        initiatedBy: 'user-admin',
        productIds: ['v-a', 'v-b'],
        sharedConfig: {
          stock: 5,
          publishImmediately: false,
          price: { amount: 10, currency: 'PLN' },
          generateDescription: true,
          descriptionTone: 'concise',
        },
      });
    });

    it('forwards perProductOverrides when present', async () => {
      bulkSubmit.submit.mockResolvedValue({ batchId: 'b-1', jobIds: [] });

      const dto: BulkOfferCreateRequestDto = {
        connectionId: '00000000-0000-4000-8000-000000000000',
        productIds: ['v-a'],
        sharedConfig: { stock: 1, publishImmediately: false },
        perProductOverrides: {
          'v-a': { stock: 42 },
        },
      };

      await controller.submit(dto, adminUser);

      expect(bulkSubmit.submit).toHaveBeenCalledWith(
        expect.objectContaining({
          perProductOverrides: { 'v-a': { stock: 42 } },
        })
      );
    });

    it('maps EmptyBulkSubmissionException to BadRequestException (HTTP 400)', async () => {
      bulkSubmit.submit.mockRejectedValue(new EmptyBulkSubmissionException());

      await expect(
        controller.submit(
          {
            connectionId: '00000000-0000-4000-8000-000000000000',
            productIds: [],
            sharedConfig: { stock: 1, publishImmediately: false },
          },
          adminUser
        )
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('propagates other exceptions unchanged (Nest filters map them to the documented codes)', async () => {
      const err = Object.assign(new Error('OfferManager not supported'), {
        name: 'CapabilityNotSupportedException',
      });
      bulkSubmit.submit.mockRejectedValue(err);

      await expect(
        controller.submit(
          {
            connectionId: '00000000-0000-4000-8000-000000000000',
            productIds: ['v-a'],
            sharedConfig: { stock: 1, publishImmediately: false },
          },
          adminUser
        )
      ).rejects.toThrow('OfferManager not supported');
    });
  });

  describe('GET /listings/bulk-create/:batchId', () => {
    it('returns the serialised summary when the batch exists', async () => {
      const batch = new BulkOfferCreationBatch(
        'b-1',
        'conn-1',
        'user-1',
        'running',
        2,
        1,
        0,
        {},
        new Date('2026-05-17T10:00:00Z'),
        new Date('2026-05-17T10:05:00Z')
      );
      const records = [
        {
          id: 'r-1',
          internalVariantId: 'v-a',
          status: 'active',
          externalOfferId: 'ext-1',
          createdAt: new Date('2026-05-17T10:01:00Z'),
          updatedAt: new Date('2026-05-17T10:02:00Z'),
        } as unknown as OfferCreationRecord,
      ];
      bulkSubmit.getBatch.mockResolvedValue({ batch, records });

      const response = await controller.getBatch('b-1');

      expect(response).toEqual({
        id: 'b-1',
        connectionId: 'conn-1',
        status: 'running',
        totalCount: 2,
        succeededCount: 1,
        failedCount: 0,
        createdAt: '2026-05-17T10:00:00.000Z',
        updatedAt: '2026-05-17T10:05:00.000Z',
        records: [
          {
            id: 'r-1',
            internalVariantId: 'v-a',
            status: 'active',
            externalOfferId: 'ext-1',
            createdAt: '2026-05-17T10:01:00.000Z',
            updatedAt: '2026-05-17T10:02:00.000Z',
          },
        ],
      });
    });

    it('returns 404 when the batch id is unknown', async () => {
      bulkSubmit.getBatch.mockResolvedValue(null);

      await expect(controller.getBatch('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('POST /listings/bulk-create/:batchId/retry-failed', () => {
    const BATCH_ID = '00000000-0000-4000-8000-00000000000a';

    it('returns the typed retry response on success (retryWaveId NOT on the wire)', async () => {
      bulkRetry.retryFailed.mockResolvedValue({
        retriedCount: 2,
        retriedRecordIds: ['r-2', 'r-4'],
        retryWaveId: 'wave-uuid-1',
        batchStatus: 'running',
      });

      const response = await controller.retryFailed(BATCH_ID);

      expect(response).toEqual({
        retriedCount: 2,
        retriedRecordIds: ['r-2', 'r-4'],
        batchStatus: 'running',
      });
      expect(response).not.toHaveProperty('retryWaveId');
      expect(bulkRetry.retryFailed).toHaveBeenCalledWith(BATCH_ID);
    });

    it('maps BulkOfferCreationBatchNotFoundException to NotFoundException (HTTP 404)', async () => {
      bulkRetry.retryFailed.mockRejectedValue(
        new BulkOfferCreationBatchNotFoundException(BATCH_ID)
      );

      await expect(controller.retryFailed(BATCH_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('maps NoFailedChildrenToRetryException to ConflictException (HTTP 409)', async () => {
      bulkRetry.retryFailed.mockRejectedValue(new NoFailedChildrenToRetryException(BATCH_ID));

      await expect(controller.retryFailed(BATCH_ID)).rejects.toBeInstanceOf(ConflictException);
    });

    it('maps AdapterCapabilityNotSupportedException to UnprocessableEntityException (HTTP 422)', async () => {
      bulkRetry.retryFailed.mockRejectedValue(
        new AdapterCapabilityNotSupportedException(BATCH_ID, 'OfferCreator')
      );

      await expect(controller.retryFailed(BATCH_ID)).rejects.toBeInstanceOf(
        UnprocessableEntityException
      );
    });

    it('maps BulkRetryMissingSnapshotException to InternalServerErrorException (HTTP 500) with the typed message', async () => {
      const recordId = 'rec-missing-snapshot';
      bulkRetry.retryFailed.mockRejectedValue(
        new BulkRetryMissingSnapshotException(recordId, BATCH_ID)
      );

      const error = await controller
        .retryFailed(BATCH_ID)
        .then(() => null)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(InternalServerErrorException);
      expect((error as Error).message).toContain(recordId);
    });
  });
});
