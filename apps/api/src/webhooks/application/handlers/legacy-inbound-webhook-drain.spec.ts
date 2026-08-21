/**
 * Legacy Inbound Webhook Drain Unit Tests
 *
 * Pins the one-shot upgrade drain (#2280): PEL pass + unread pass through the
 * new resolve→gate path, trimmed entries ACKed without a row, the legacy
 * `published`-row self-heal (gate replay → rank-guarded status advance), the
 * per-entry transient isolation (failing entry left un-ACKed), and the
 * never-block-boot guarantee.
 *
 * @module apps/api/src/webhooks/application/handlers
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { WebhookDeliveryRepositoryPort } from '@openlinker/core/webhooks';
import { WEBHOOK_DELIVERY_REPOSITORY_TOKEN } from '@openlinker/core/webhooks';
import type { SyncJobRequest } from '@openlinker/core/sync';
import { LegacyInboundWebhookDrain } from './legacy-inbound-webhook-drain';
import type { IInboundWebhookRoutingService } from '../interfaces/inbound-webhook-routing.service.interface';
import { INBOUND_WEBHOOK_ROUTING_SERVICE_TOKEN } from '../interfaces/inbound-webhook-routing.service.interface';
import type { IWebhookJobGateService } from '../interfaces/webhook-job-gate.service.interface';
import { WEBHOOK_JOB_GATE_SERVICE_TOKEN } from '../interfaces/webhook-job-gate.service.interface';

const connectionId = '123e4567-e89b-12d3-a456-426614174000';

interface MockRedisClient {
  xGroupCreate: jest.Mock;
  xAck: jest.Mock;
  xReadGroup: jest.Mock;
  xPendingRange: jest.Mock;
  xRange: jest.Mock;
  xClaim: jest.Mock;
}

function streamEntryFields(eventId: string): Record<string, string> {
  return {
    eventId,
    eventType: 'inbound.webhook.product.saved',
    payloadJson: JSON.stringify({ objectType: 'product', externalId: '12345', payload: {} }),
    metadataJson: JSON.stringify({ provider: 'prestashop', connectionId }),
    occurredAt: '2026-06-08T10:00:00.000Z',
    publishedAt: '2026-06-08T10:00:01.000Z',
  };
}

function pendingRow(id: string): Record<string, unknown> {
  return { id, owner: 'old-consumer', millisecondsSinceLastDelivery: 5_000, deliveriesCounter: 1 };
}

const routedJob: SyncJobRequest = {
  jobType: 'master.product.syncByExternalId',
  connectionId,
  payload: { schemaVersion: 1, externalId: '12345', objectType: 'Product' },
  idempotencyKey: `prestashop:${connectionId}:e1`,
};

describe('LegacyInboundWebhookDrain', () => {
  let drain: LegacyInboundWebhookDrain;
  let redisClient: MockRedisClient;
  let inboundRouting: jest.Mocked<IInboundWebhookRoutingService>;
  let jobGate: jest.Mocked<IWebhookJobGateService>;
  let deliveryRepository: jest.Mocked<Pick<WebhookDeliveryRepositoryPort, 'upsert'>>;

  beforeEach(async () => {
    redisClient = {
      xGroupCreate: jest.fn().mockRejectedValue(new Error('BUSYGROUP Consumer Group name exists')),
      xAck: jest.fn().mockResolvedValue(1),
      xReadGroup: jest.fn().mockResolvedValue(null),
      xPendingRange: jest.fn().mockResolvedValue([]),
      xRange: jest.fn().mockResolvedValue([]),
      xClaim: jest.fn().mockResolvedValue([]),
    };
    inboundRouting = {
      resolveEvent: jest.fn().mockResolvedValue({ kind: 'routed', job: routedJob }),
    };
    jobGate = {
      insertDeliveryWithJob: jest.fn().mockResolvedValue({ isNew: true, jobId: 'job-uuid-1' }),
    };
    deliveryRepository = { upsert: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LegacyInboundWebhookDrain,
        { provide: 'REDIS_CLIENT', useValue: redisClient },
        { provide: INBOUND_WEBHOOK_ROUTING_SERVICE_TOKEN, useValue: inboundRouting },
        { provide: WEBHOOK_JOB_GATE_SERVICE_TOKEN, useValue: jobGate },
        { provide: WEBHOOK_DELIVERY_REPOSITORY_TOKEN, useValue: deliveryRepository },
      ],
    }).compile();
    drain = module.get(LegacyInboundWebhookDrain);
  });

  describe('group handling', () => {
    it('swallows BUSYGROUP (pre-existing group is the interesting case) and drains', async () => {
      await drain.onModuleInit();

      expect(redisClient.xPendingRange).toHaveBeenCalled();
      expect(redisClient.xReadGroup).toHaveBeenCalled();
    });

    it('skips the drain entirely when the group cannot be ensured (Redis down)', async () => {
      redisClient.xGroupCreate.mockRejectedValue(new Error('ECONNREFUSED'));

      await drain.onModuleInit();

      expect(redisClient.xPendingRange).not.toHaveBeenCalled();
      expect(redisClient.xReadGroup).not.toHaveBeenCalled();
    });

    it('never blocks boot on a drain failure', async () => {
      redisClient.xPendingRange.mockRejectedValue(new Error('redis exploded'));

      await expect(drain.onModuleInit()).resolves.toBeUndefined();
    });
  });

  describe('PEL pass (pre-upgrade in-flight entries)', () => {
    it('routes a pending entry through the gate and ACKs it', async () => {
      redisClient.xPendingRange.mockResolvedValueOnce([pendingRow('1-1')]).mockResolvedValue([]);
      redisClient.xRange.mockResolvedValueOnce([{ id: '1-1', message: streamEntryFields('e1') }]);

      await drain.onModuleInit();

      expect(jobGate.insertDeliveryWithJob).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'e1', status: 'job_enqueued' }),
        routedJob
      );
      expect(redisClient.xAck).toHaveBeenCalledWith(
        'events.inbound.webhooks',
        'webhook-handler',
        '1-1'
      );
    });

    it('self-heals a legacy published row: gate replay → rank-guarded status advance with the job id', async () => {
      redisClient.xPendingRange.mockResolvedValueOnce([pendingRow('1-1')]).mockResolvedValue([]);
      redisClient.xRange.mockResolvedValueOnce([{ id: '1-1', message: streamEntryFields('e1') }]);
      jobGate.insertDeliveryWithJob.mockResolvedValue({ isNew: false, jobId: 'job-uuid-1' });

      await drain.onModuleInit();

      expect(deliveryRepository.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 'e1',
          status: 'job_enqueued',
          downstreamJobId: 'job-uuid-1',
          downstreamJobType: routedJob.jobType,
        })
      );
      expect(redisClient.xAck).toHaveBeenCalled();
    });

    it('ACKs a trimmed entry (body gone, id still in the PEL) without writing any row', async () => {
      redisClient.xPendingRange.mockResolvedValueOnce([pendingRow('1-1')]).mockResolvedValue([]);
      redisClient.xRange.mockResolvedValueOnce([]);

      await drain.onModuleInit();

      expect(jobGate.insertDeliveryWithJob).not.toHaveBeenCalled();
      expect(deliveryRepository.upsert).not.toHaveBeenCalled();
      expect(redisClient.xAck).toHaveBeenCalledWith(
        'events.inbound.webhooks',
        'webhook-handler',
        '1-1'
      );
    });

    it('records an unroutable entry as a deadlettered delivery row and ACKs it', async () => {
      redisClient.xPendingRange.mockResolvedValueOnce([pendingRow('1-1')]).mockResolvedValue([]);
      redisClient.xRange.mockResolvedValueOnce([{ id: '1-1', message: streamEntryFields('e1') }]);
      inboundRouting.resolveEvent.mockResolvedValue({
        kind: 'unroutable',
        reason: 'no-translator: foo.v1',
      });

      await drain.onModuleInit();

      expect(deliveryRepository.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'deadlettered', dlqReason: 'no-translator: foo.v1' })
      );
      expect(jobGate.insertDeliveryWithJob).not.toHaveBeenCalled();
      expect(redisClient.xAck).toHaveBeenCalled();
    });

    it('leaves a transiently-failing entry un-ACKed for the next boot', async () => {
      redisClient.xPendingRange.mockResolvedValueOnce([pendingRow('1-1')]).mockResolvedValue([]);
      redisClient.xRange.mockResolvedValueOnce([{ id: '1-1', message: streamEntryFields('e1') }]);
      inboundRouting.resolveEvent.mockRejectedValue(new Error('db blip'));

      await drain.onModuleInit();

      expect(redisClient.xAck).not.toHaveBeenCalled();
    });

    it('advances with an exclusive cursor so a failing entry cannot loop its own page', async () => {
      redisClient.xPendingRange.mockResolvedValueOnce([pendingRow('1-1')]).mockResolvedValue([]);
      redisClient.xRange.mockResolvedValueOnce([{ id: '1-1', message: streamEntryFields('e1') }]);
      inboundRouting.resolveEvent.mockRejectedValue(new Error('db blip'));

      await drain.onModuleInit();

      expect(redisClient.xPendingRange).toHaveBeenNthCalledWith(
        2,
        'events.inbound.webhooks',
        'webhook-handler',
        '(1-1',
        '+',
        50
      );
    });
  });

  describe('unread pass (never-delivered entries)', () => {
    it('drains unread entries via non-blocking XREADGROUP through the same path', async () => {
      redisClient.xReadGroup
        .mockResolvedValueOnce([
          {
            name: 'events.inbound.webhooks',
            messages: [{ id: '2-1', message: streamEntryFields('e2') }],
          },
        ])
        .mockResolvedValue(null);

      await drain.onModuleInit();

      expect(jobGate.insertDeliveryWithJob).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'e2' }),
        routedJob
      );
      expect(redisClient.xAck).toHaveBeenCalledWith(
        'events.inbound.webhooks',
        'webhook-handler',
        '2-1'
      );
    });

    it('ACKs an unparseable entry without writing a row so it stops re-presenting', async () => {
      redisClient.xReadGroup
        .mockResolvedValueOnce([
          {
            name: 'events.inbound.webhooks',
            messages: [
              {
                id: '2-1',
                message: {
                  eventId: '',
                  eventType: 'inbound.webhook.product.saved',
                  payloadJson: '{}',
                  metadataJson: '{}',
                  occurredAt: 'x',
                  publishedAt: 'x',
                },
              },
            ],
          },
        ])
        .mockResolvedValue(null);

      await drain.onModuleInit();

      expect(jobGate.insertDeliveryWithJob).not.toHaveBeenCalled();
      expect(redisClient.xAck).toHaveBeenCalledWith(
        'events.inbound.webhooks',
        'webhook-handler',
        '2-1'
      );
    });
  });
});
