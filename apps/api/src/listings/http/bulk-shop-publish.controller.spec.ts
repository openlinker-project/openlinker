/**
 * Bulk Shop Publish Controller - retry-failed route (U21)
 *
 * Pins the error mapping of the shop-publish retry route, which mirrors the
 * bulk-create one: 404 / 409 / 500 carry stable codes the frontend branches on.
 */
import { ConflictException, InternalServerErrorException, NotFoundException } from '@nestjs/common';

import {
  BulkListingBatchNotFoundException,
  BulkRetryMissingSnapshotException,
  NoFailedChildrenToRetryException,
} from '@openlinker/core/listings';
import type {
  IBulkShopPublishRetryService,
  IBulkShopPublishSubmitService,
} from '@openlinker/core/listings';

import { BulkShopPublishController } from './bulk-shop-publish.controller';

const BATCH_ID = '11111111-1111-4111-8111-111111111111';

describe('BulkShopPublishController retryFailed', () => {
  let retry: jest.Mocked<IBulkShopPublishRetryService>;
  let controller: BulkShopPublishController;

  beforeEach(() => {
    retry = { retryFailed: jest.fn() };
    controller = new BulkShopPublishController(
      {} as unknown as IBulkShopPublishSubmitService,
      retry,
    );
  });

  it('should return the retried record ids when the service succeeds', async () => {
    retry.retryFailed.mockResolvedValue({
      retriedCount: 1,
      retriedRecordIds: ['rec-1'],
      retryWaveId: 'wave',
      batchStatus: 'running',
    });

    await expect(controller.retryFailed(BATCH_ID)).resolves.toEqual({
      retriedRecordIds: ['rec-1'],
      retriedCount: 1,
      batchStatus: 'running',
    });
  });

  it('should answer 404 when the batch does not exist', async () => {
    retry.retryFailed.mockRejectedValue(new BulkListingBatchNotFoundException(BATCH_ID));
    await expect(controller.retryFailed(BATCH_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('should answer 409 when nothing failed', async () => {
    retry.retryFailed.mockRejectedValue(new NoFailedChildrenToRetryException(BATCH_ID));
    await expect(controller.retryFailed(BATCH_ID)).rejects.toBeInstanceOf(ConflictException);
  });

  it('should answer 500 when a record has no request snapshot', async () => {
    retry.retryFailed.mockRejectedValue(new BulkRetryMissingSnapshotException('rec-1', BATCH_ID));
    await expect(controller.retryFailed(BATCH_ID)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});
