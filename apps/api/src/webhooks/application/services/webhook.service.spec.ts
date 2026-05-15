/**
 * Webhook Service Unit Tests
 *
 * Focused coverage for the dedup-gate + failure-recovery branches added in
 * #711. Integration coverage of the full happy path lives in
 * `apps/api/test/integration/webhook-ingestion.int-spec.ts`.
 *
 * @module apps/api/src/webhooks/application/services
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { WebhookService } from './webhook.service';
import { WebhookAuthService } from './webhook-auth.service';
import { WebhookDedupService } from './webhook-dedup.service';
import { WebhookEventPublisher } from './webhook-event-publisher.service';
import type {
  WebhookDeliveryRepositoryPort,
  WebhookDelivery,
  WebhookDeliveryUpsertInput,
} from '@openlinker/core/webhooks';
import { WEBHOOK_DELIVERY_REPOSITORY_TOKEN } from '@openlinker/core/webhooks';
import type { WebhookRequestDto } from '../../http/dto/webhook-request.dto';
import { WebhookReplayException } from '../errors/webhook-replay.exception';

function makeRequest(eventId: string): WebhookRequestDto {
  return {
    schemaVersion: 1,
    eventId,
    eventType: 'product.saved',
    occurredAt: new Date().toISOString(),
    object: { type: 'product', externalId: '12345' },
    payload: { name: 'Test' },
  } as WebhookRequestDto;
}

function makeDelivery(input: WebhookDeliveryUpsertInput): WebhookDelivery {
  return {
    id: 'wd_test',
    eventId: input.eventId,
    provider: input.provider,
    connectionId: input.connectionId,
    eventType: input.eventType ?? null,
    objectType: input.objectType ?? null,
    externalId: input.externalId ?? null,
    receivedAt: input.receivedAt ?? new Date(),
    signatureValid: input.signatureValid ?? null,
    dedupResult: input.dedupResult ?? null,
    status: input.status ?? 'received',
    rejectionReason: input.rejectionReason ?? null,
    publishedMessageId: input.publishedMessageId ?? null,
    downstreamJobId: input.downstreamJobId ?? null,
    downstreamJobType: input.downstreamJobType ?? null,
    dlqReason: input.dlqReason ?? null,
    payload: input.payload ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as WebhookDelivery;
}

describe('WebhookService (#711 dedup + failure-recovery branches)', () => {
  let service: WebhookService;
  let authService: jest.Mocked<Pick<WebhookAuthService, 'validateTimestamp' | 'verifySignature'>>;
  let dedupService: jest.Mocked<
    Pick<WebhookDedupService, 'markProcessing' | 'markDone' | 'clearProcessing'>
  >;
  let eventPublisher: jest.Mocked<Pick<WebhookEventPublisher, 'publishInboundWebhook'>>;
  let deliveryRepository: jest.Mocked<WebhookDeliveryRepositoryPort>;

  const provider = 'prestashop';
  const connectionId = '123e4567-e89b-12d3-a456-426614174000';
  const rawBody = Buffer.from('{}');
  const headers: Record<string, string> = {
    'x-openlinker-timestamp': Date.now().toString(),
    'x-openlinker-signature': 'sha256=' + 'a'.repeat(64),
  };

  beforeEach(async () => {
    authService = {
      validateTimestamp: jest.fn().mockReturnValue(true),
      verifySignature: jest.fn().mockResolvedValue(true),
    };
    dedupService = {
      markProcessing: jest.fn().mockResolvedValue(true),
      markDone: jest.fn().mockResolvedValue(undefined),
      clearProcessing: jest.fn().mockResolvedValue(undefined),
    };
    eventPublisher = {
      publishInboundWebhook: jest.fn().mockResolvedValue('msg_1'),
    };
    deliveryRepository = {
      upsert: jest.fn().mockImplementation((input: WebhookDeliveryUpsertInput) =>
        Promise.resolve(makeDelivery(input))
      ),
      insertIfNew: jest.fn(),
      deleteByEventKey: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn(),
      findMany: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookService,
        { provide: WebhookAuthService, useValue: authService },
        { provide: WebhookDedupService, useValue: dedupService },
        { provide: WebhookEventPublisher, useValue: eventPublisher },
        { provide: WEBHOOK_DELIVERY_REPOSITORY_TOKEN, useValue: deliveryRepository },
      ],
    }).compile();
    service = module.get(WebhookService);
  });

  describe('Postgres dedup gate', () => {
    it('publishes the event when insertIfNew reports isNew=true', async () => {
      deliveryRepository.insertIfNew.mockResolvedValue({
        isNew: true,
        delivery: makeDelivery({ eventId: 'e1', provider, connectionId }),
      });

      await service.processWebhook(provider, connectionId, makeRequest('e1'), rawBody, headers);

      expect(eventPublisher.publishInboundWebhook).toHaveBeenCalledTimes(1);
      expect(deliveryRepository.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'published' })
      );
    });

    it('short-circuits with no publish when insertIfNew reports isNew=false (replay)', async () => {
      deliveryRepository.insertIfNew.mockResolvedValue({
        isNew: false,
        existing: makeDelivery({ eventId: 'e2', provider, connectionId }),
      });

      await service.processWebhook(provider, connectionId, makeRequest('e2'), rawBody, headers);

      expect(eventPublisher.publishInboundWebhook).not.toHaveBeenCalled();
      expect(dedupService.markProcessing).not.toHaveBeenCalled();
      expect(deliveryRepository.upsert).not.toHaveBeenCalled();
    });
  });

  describe('failure-recovery (the load-bearing #711 fix)', () => {
    it('DELETEs the webhook_deliveries row when publish fails, so source can retry', async () => {
      deliveryRepository.insertIfNew.mockResolvedValue({
        isNew: true,
        delivery: makeDelivery({ eventId: 'e3', provider, connectionId }),
      });
      eventPublisher.publishInboundWebhook.mockRejectedValueOnce(new Error('stream down'));

      await expect(
        service.processWebhook(provider, connectionId, makeRequest('e3'), rawBody, headers)
      ).rejects.toThrow('stream down');

      // The failure-recovery semantics: row deleted, Redis cleared, error rethrown.
      expect(deliveryRepository.deleteByEventKey).toHaveBeenCalledWith(provider, connectionId, 'e3');
      expect(dedupService.clearProcessing).toHaveBeenCalledWith(provider, connectionId, 'e3');
    });
  });

  describe('validation rejection (no row inserted)', () => {
    it('does not insert a row when timestamp is stale', async () => {
      authService.validateTimestamp.mockImplementation(() => {
        throw new WebhookReplayException('stale', headers['x-openlinker-timestamp'], 120_000);
      });

      await expect(
        service.processWebhook(provider, connectionId, makeRequest('e4'), rawBody, headers)
      ).rejects.toThrow(WebhookReplayException);

      expect(deliveryRepository.insertIfNew).not.toHaveBeenCalled();
      expect(deliveryRepository.upsert).not.toHaveBeenCalled();
    });

    it('does not insert a row when signature is invalid', async () => {
      authService.verifySignature.mockResolvedValue(false);

      await expect(
        service.processWebhook(provider, connectionId, makeRequest('e5'), rawBody, headers)
      ).rejects.toThrow('Invalid webhook signature');

      expect(deliveryRepository.insertIfNew).not.toHaveBeenCalled();
      expect(deliveryRepository.upsert).not.toHaveBeenCalled();
    });
  });
});
