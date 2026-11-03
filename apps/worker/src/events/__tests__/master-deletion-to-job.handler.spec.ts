/**
 * Master Deletion to Job Handler Unit Tests (#1689)
 *
 * Covers: BUSYGROUP tolerance on group-create, enqueue-then-ACK ordering,
 * dead-letter on a malformed payload, no-ACK on a transient enqueue failure,
 * and tolerance of a v1 payload (missing correlationId/externalId).
 *
 * @module apps/worker/src/events/__tests__
 */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return -- test: invoke private processMessage/initializeConsumerGroup/recoverEntrySafely */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { RedisClientType } from 'redis';
import { JOB_ENQUEUE_TOKEN, type JobEnqueuePort } from '@openlinker/core/sync';
import type { IStreamDeadLettersService } from '@openlinker/core/events';
import { STREAM_DEAD_LETTERS_SERVICE_TOKEN } from '@openlinker/core/events';
import { MAX_RECOVERY_ATTEMPTS } from '@openlinker/shared/redis';
import { MasterDeletionToJobHandler } from '../master-deletion-to-job.handler';
import { MASTER_DELETION_REDIS_CLIENT_BLOCKING_TOKEN } from '../events.tokens';

const STREAM = 'events.master.deletion';
const DLQ = 'events.master.deletion.dead';
const GROUP = 'master-deletion-offer-pause';

type MockedRedis = jest.Mocked<
  Pick<
    RedisClientType,
    'xGroupCreate' | 'xReadGroup' | 'xAck' | 'xAdd' | 'quit' | 'incr' | 'expire' | 'del'
  >
>;

describe('MasterDeletionToJobHandler', () => {
  let handler: MasterDeletionToJobHandler;
  let redis: MockedRedis;
  let jobEnqueue: jest.Mocked<JobEnqueuePort>;
  let streamDeadLetters: jest.Mocked<IStreamDeadLettersService>;

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
    // incr/expire/del back RecoveryAttemptTracker's Redis-persisted poison
    // counter (#2301, D48) — see the identical rationale in
    // job-intake.consumer.spec.ts.
    const counterStore = new Map<string, number>();
    redis = {
      xGroupCreate: jest.fn(),
      xReadGroup: jest.fn(),
      xAck: jest.fn().mockResolvedValue(1),
      xAdd: jest.fn().mockResolvedValue('1-0'),
      quit: jest.fn().mockResolvedValue(undefined),
      incr: jest.fn((key: string) => {
        const next = (counterStore.get(key) ?? 0) + 1;
        counterStore.set(key, next);
        return Promise.resolve(next);
      }),
      expire: jest.fn().mockResolvedValue(true),
      del: jest.fn((key: string) => Promise.resolve(counterStore.delete(key) ? 1 : 0)),
    } as unknown as MockedRedis;

    jobEnqueue = {
      enqueueJob: jest.fn().mockResolvedValue({ jobId: 'job-1', isExisting: false }),
    } as unknown as jest.Mocked<JobEnqueuePort>;

    streamDeadLetters = {
      record: jest.fn(),
      list: jest.fn(),
      count: jest.fn(),
    } as unknown as jest.Mocked<IStreamDeadLettersService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MasterDeletionToJobHandler,
        { provide: MASTER_DELETION_REDIS_CLIENT_BLOCKING_TOKEN, useValue: redis },
        { provide: JOB_ENQUEUE_TOKEN, useValue: jobEnqueue },
        { provide: STREAM_DEAD_LETTERS_SERVICE_TOKEN, useValue: streamDeadLetters },
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
        expect.objectContaining({ errorReason: expect.stringContaining('unparseable') }),
        // Age-bounded (#2163): this DLQ has no Postgres counterpart, so it is
        // the sole record that a deletion event was discarded.
        expect.objectContaining({ TRIM: expect.objectContaining({ strategy: 'MINID' }) })
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

  describe('poison-entry terminal write (#2301, D48)', () => {
    // Mirrors job-intake.consumer.spec.ts's block of the same name: this
    // handler has its OWN deadLetterPoisonEntry, distinct from the
    // pre-existing malformed-payload deadLetter() exercised above — a
    // different mechanism for a different failure mode (repeated recovery
    // failure vs. a deterministically-unparseable payload).
    const poisonEntry = { kind: 'entry', id: '1-0', fields: fields(), deliveryCount: 1 };

    const runRecovery = async (): Promise<string> =>
      await (handler as any).recoverEntrySafely(poisonEntry, 'startup-drain');

    const failUntilThreshold = async (attempts: number): Promise<void> => {
      jest
        .spyOn(handler as any, 'handleRecoveredEntry')
        .mockRejectedValue(new Error('handler blew up'));
      for (let i = 0; i < attempts; i += 1) {
        await runRecovery();
      }
    };

    it('should write the durable row and only then XACK the entry', async () => {
      streamDeadLetters.record.mockResolvedValue({} as any);

      await failUntilThreshold(MAX_RECOVERY_ATTEMPTS);

      expect(streamDeadLetters.record).toHaveBeenCalledWith(
        expect.objectContaining({
          stream: STREAM,
          consumerGroup: GROUP,
          entryId: '1-0',
          attempts: MAX_RECOVERY_ATTEMPTS,
          lastError: 'handler blew up',
        })
      );
      expect(redis.xAck).toHaveBeenCalledWith(STREAM, GROUP, '1-0');

      const recordOrder = streamDeadLetters.record.mock.invocationCallOrder[0];
      const ackOrder = (redis.xAck as jest.Mock).mock.invocationCallOrder[0];
      expect(recordOrder).toBeLessThan(ackOrder);
    });

    it('should leave the entry pending — never ack — when the durable write fails', async () => {
      streamDeadLetters.record.mockRejectedValue(new Error('db unavailable'));

      await failUntilThreshold(MAX_RECOVERY_ATTEMPTS);

      expect(streamDeadLetters.record).toHaveBeenCalled();
      expect(redis.xAck).not.toHaveBeenCalled();
    });
  });
});
