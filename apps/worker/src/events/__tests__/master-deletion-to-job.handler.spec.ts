/**
 * Master Deletion to Job Handler Unit Tests (#1689)
 *
 * Covers: BUSYGROUP tolerance on group-create, enqueue-then-ACK ordering,
 * dead-letter on a malformed payload, no-ACK on a transient enqueue failure,
 * and tolerance of a v1 payload (missing correlationId/externalId).
 *
 * @module apps/worker/src/events/__tests__
 */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- test: invoke private processMessage/initializeConsumerGroup */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { RedisClientType } from 'redis';
import { JOB_ENQUEUE_TOKEN, type JobEnqueuePort } from '@openlinker/core/sync';
import { MasterDeletionToJobHandler } from '../master-deletion-to-job.handler';
import { MASTER_DELETION_REDIS_CLIENT_BLOCKING_TOKEN } from '../events.tokens';

const STREAM = 'events.master.deletion';
const DLQ = 'events.master.deletion.dead';
const GROUP = 'master-deletion-offer-pause';

describe('MasterDeletionToJobHandler', () => {
  let handler: MasterDeletionToJobHandler;
  let redis: jest.Mocked<Pick<RedisClientType, 'xGroupCreate' | 'xReadGroup' | 'xAck' | 'xAdd' | 'quit'>>;
  let jobEnqueue: jest.Mocked<JobEnqueuePort>;

  const fields = (overrides: Record<string, string> = {}): Record<string, string> => ({
    eventId: 'evt-1',
    eventType: 'master.variant.stale',
    payloadJson: JSON.stringify({
      connectionId: 'conn-master',
      internalProductId: 'ol_product_1',
      variantIds: ['ol_variant_a'],
      correlationId: 'corr-1',
      externalId: 'ext-9',
    }),
    occurredAt: '2026-07-27T00:00:00.000Z',
    publishedAt: '2026-07-27T00:00:01.000Z',
    ...overrides,
  });

  const processMessage = (id: string, f: Record<string, string>): Promise<void> =>
    (handler as any).processMessage(id, f) as Promise<void>;

  beforeEach(async () => {
    redis = {
      xGroupCreate: jest.fn(),
      xReadGroup: jest.fn(),
      xAck: jest.fn().mockResolvedValue(1),
      xAdd: jest.fn().mockResolvedValue('1-0'),
      quit: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<
      Pick<RedisClientType, 'xGroupCreate' | 'xReadGroup' | 'xAck' | 'xAdd' | 'quit'>
    >;

    jobEnqueue = {
      enqueueJob: jest.fn().mockResolvedValue({ jobId: 'job-1', isExisting: false }),
    } as unknown as jest.Mocked<JobEnqueuePort>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MasterDeletionToJobHandler,
        { provide: MASTER_DELETION_REDIS_CLIENT_BLOCKING_TOKEN, useValue: redis },
        { provide: JOB_ENQUEUE_TOKEN, useValue: jobEnqueue },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((_key: string, defaultValue?: string) => defaultValue) },
        },
      ],
    }).compile();

    handler = module.get(MasterDeletionToJobHandler);
  });

  describe('initializeConsumerGroup', () => {
    it('creates the consumer group', async () => {
      redis.xGroupCreate.mockResolvedValueOnce('OK' as never);

      await (handler as any).initializeConsumerGroup();

      expect(redis.xGroupCreate).toHaveBeenCalledWith(STREAM, GROUP, '$', { MKSTREAM: true });
    });

    it('tolerates a BUSYGROUP error (group already exists)', async () => {
      redis.xGroupCreate.mockRejectedValueOnce(
        new Error('BUSYGROUP Consumer Group name already exists')
      );

      await expect((handler as any).initializeConsumerGroup()).resolves.toBeUndefined();
    });

    it('rethrows a non-BUSYGROUP error', async () => {
      redis.xGroupCreate.mockRejectedValueOnce(new Error('connection refused'));

      await expect((handler as any).initializeConsumerGroup()).rejects.toThrow(
        'connection refused'
      );
    });
  });

  describe('processMessage', () => {
    it('enqueues the pauseStale job then ACKs (enqueue-before-ack ordering)', async () => {
      const callOrder: string[] = [];
      jobEnqueue.enqueueJob.mockImplementationOnce(() => {
        callOrder.push('enqueue');
        return Promise.resolve({ jobId: 'job-1', isExisting: false });
      });
      redis.xAck.mockImplementationOnce(() => {
        callOrder.push('ack');
        return Promise.resolve(1);
      });

      await processMessage('1-0', fields());

      expect(callOrder).toEqual(['enqueue', 'ack']);
      expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({
          jobType: 'marketplace.offer.pauseStale',
          connectionId: '00000000-0000-0000-0000-000000000000',
          payload: expect.objectContaining({
            internalProductId: 'ol_product_1',
            variantIds: ['ol_variant_a'],
            correlationId: 'corr-1',
          }),
          idempotencyKey: 'stale-pause:ol_product_1:evt-1',
        })
      );
      expect(redis.xAck).toHaveBeenCalledWith(STREAM, GROUP, '1-0');
    });

    it('tolerates a v1 payload missing correlationId/externalId', async () => {
      const v1Fields = fields({
        payloadJson: JSON.stringify({
          connectionId: 'conn-master',
          internalProductId: 'ol_product_1',
          variantIds: ['ol_variant_a'],
        }),
      });

      await processMessage('1-0', v1Fields);

      expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ correlationId: 'evt-1' }),
        })
      );
      expect(redis.xAck).toHaveBeenCalled();
    });

    it('dead-letters and ACKs a malformed payload without enqueuing', async () => {
      const badFields = fields({ payloadJson: 'not-json{' });

      await processMessage('1-0', badFields);

      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
      expect(redis.xAdd).toHaveBeenCalledWith(
        DLQ,
        '*',
        expect.objectContaining({ errorReason: expect.stringContaining('unparseable') })
      );
      expect(redis.xAck).toHaveBeenCalledWith(STREAM, GROUP, '1-0');
    });

    it('dead-letters a payload missing required fields without enqueuing', async () => {
      const badFields = fields({
        payloadJson: JSON.stringify({ connectionId: 'conn-master' }),
      });

      await processMessage('1-0', badFields);

      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
      expect(redis.xAdd).toHaveBeenCalled();
      expect(redis.xAck).toHaveBeenCalledWith(STREAM, GROUP, '1-0');
    });

    it('does not ACK on a transient enqueue failure (allows redelivery)', async () => {
      jobEnqueue.enqueueJob.mockRejectedValueOnce(new Error('redis unavailable'));

      await expect(processMessage('1-0', fields())).rejects.toThrow('redis unavailable');

      expect(redis.xAck).not.toHaveBeenCalled();
    });
  });
});
