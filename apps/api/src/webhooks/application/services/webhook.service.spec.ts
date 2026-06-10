/**
 * Webhook Service Unit Tests
 *
 * Covers the ADR-021 decoder-dispatch flow (verify → replay → extract →
 * dedup/publish), the three-state decode (route / ignore / reject), and the
 * #711 dedup-gate + failure-recovery branches. Integration coverage of the
 * full happy path lives in `apps/api/test/integration/webhook-ingestion.int-spec.ts`.
 *
 * @module apps/api/src/webhooks/application/services
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type {
  DecodeResult,
  InboundWebhookDecoderPort,
  InboundWebhookDecoderRegistryService,
} from '@openlinker/core/integrations';
import { INBOUND_WEBHOOK_DECODER_REGISTRY_TOKEN } from '@openlinker/core/integrations';
import type {
  WebhookDeliveryRepositoryPort,
  WebhookDelivery,
  WebhookDeliveryUpsertInput,
} from '@openlinker/core/webhooks';
import { WEBHOOK_DELIVERY_REPOSITORY_TOKEN } from '@openlinker/core/webhooks';
import { WebhookService } from './webhook.service';
import { WebhookAuthService } from './webhook-auth.service';
import { WebhookDedupService } from './webhook-dedup.service';
import { WebhookEventPublisher } from './webhook-event-publisher.service';
import { DefaultWebhookDecoder } from '../decoders/default-webhook-decoder';
import { WebhookReplayException } from '../errors/webhook-replay.exception';
import { WebhookAuthenticationException } from '../errors/webhook-authentication.exception';
import { WebhookDecodeException } from '../errors/webhook-decode.exception';

function routeResult(eventId: string): DecodeResult {
  return {
    action: 'route',
    envelope: {
      eventId,
      eventType: 'product.saved',
      occurredAt: '2026-06-08T10:00:00.000Z',
      objectType: 'product',
      externalId: '12345',
      payload: { name: 'Test' },
    },
  };
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

describe('WebhookService (ADR-021 decoder dispatch + #711 dedup/recovery)', () => {
  let service: WebhookService;
  let authService: jest.Mocked<
    Pick<WebhookAuthService, 'assertConnectionUsable' | 'getSecret' | 'validateTimestampMs'>
  >;
  let decoder: jest.Mocked<InboundWebhookDecoderPort>;
  let decoderRegistry: jest.Mocked<Pick<InboundWebhookDecoderRegistryService, 'get'>>;
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
      assertConnectionUsable: jest.fn().mockResolvedValue(undefined),
      getSecret: jest.fn().mockResolvedValue('secret'),
      validateTimestampMs: jest.fn(),
    };
    decoder = {
      verify: jest.fn().mockReturnValue({ ok: true, timestampMs: Date.now() }),
      extractEnvelope: jest.fn().mockReturnValue(routeResult('e1')),
    };
    // Registry returns undefined → the host falls back to the default decoder.
    decoderRegistry = { get: jest.fn().mockReturnValue(undefined) };
    dedupService = {
      markProcessing: jest.fn().mockResolvedValue(true),
      markDone: jest.fn().mockResolvedValue(undefined),
      clearProcessing: jest.fn().mockResolvedValue(undefined),
    };
    eventPublisher = { publishInboundWebhook: jest.fn().mockResolvedValue('msg_1') };
    deliveryRepository = {
      upsert: jest
        .fn()
        .mockImplementation((input: WebhookDeliveryUpsertInput) =>
          Promise.resolve(makeDelivery(input)),
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
        { provide: DefaultWebhookDecoder, useValue: decoder },
        { provide: INBOUND_WEBHOOK_DECODER_REGISTRY_TOKEN, useValue: decoderRegistry },
        { provide: WebhookDedupService, useValue: dedupService },
        { provide: WebhookEventPublisher, useValue: eventPublisher },
        { provide: WEBHOOK_DELIVERY_REPOSITORY_TOKEN, useValue: deliveryRepository },
      ],
    }).compile();
    service = module.get(WebhookService);
  });

  describe('decoder dispatch + three-state decode', () => {
    it('publishes a routed event when the decoder verifies + routes and the row is new', async () => {
      deliveryRepository.insertIfNew.mockResolvedValue({
        isNew: true,
        delivery: makeDelivery({ eventId: 'e1', provider, connectionId }),
      });

      await service.processWebhook(provider, connectionId, rawBody, headers);

      expect(authService.assertConnectionUsable).toHaveBeenCalledWith(provider, connectionId);
      expect(decoder.verify).toHaveBeenCalled();
      expect(eventPublisher.publishInboundWebhook).toHaveBeenCalledTimes(1);
      expect(deliveryRepository.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'published', externalId: '12345' }),
      );
    });

    it('ignores (202, no publish, no row) when the decoder returns ignore', async () => {
      decoder.extractEnvelope.mockReturnValue({ action: 'ignore', reason: 'unhandled topic' });

      await service.processWebhook(provider, connectionId, rawBody, headers);

      expect(deliveryRepository.insertIfNew).not.toHaveBeenCalled();
      expect(eventPublisher.publishInboundWebhook).not.toHaveBeenCalled();
    });

    it('throws WebhookDecodeException (→400) and inserts no row when the decoder rejects', async () => {
      decoder.extractEnvelope.mockReturnValue({ action: 'reject', reason: 'malformed' });

      await expect(
        service.processWebhook(provider, connectionId, rawBody, headers),
      ).rejects.toThrow(WebhookDecodeException);

      expect(deliveryRepository.insertIfNew).not.toHaveBeenCalled();
    });
  });

  describe('Postgres dedup gate', () => {
    it('short-circuits with no publish when insertIfNew reports isNew=false (replay)', async () => {
      deliveryRepository.insertIfNew.mockResolvedValue({
        isNew: false,
        existing: makeDelivery({ eventId: 'e1', provider, connectionId }),
      });

      await service.processWebhook(provider, connectionId, rawBody, headers);

      expect(eventPublisher.publishInboundWebhook).not.toHaveBeenCalled();
      expect(dedupService.markProcessing).not.toHaveBeenCalled();
      expect(deliveryRepository.upsert).not.toHaveBeenCalled();
    });
  });

  describe('failure-recovery (the load-bearing #711 fix)', () => {
    it('DELETEs the webhook_deliveries row when publish fails, so source can retry', async () => {
      deliveryRepository.insertIfNew.mockResolvedValue({
        isNew: true,
        delivery: makeDelivery({ eventId: 'e1', provider, connectionId }),
      });
      eventPublisher.publishInboundWebhook.mockRejectedValueOnce(new Error('stream down'));

      await expect(
        service.processWebhook(provider, connectionId, rawBody, headers),
      ).rejects.toThrow('stream down');

      expect(deliveryRepository.deleteByEventKey).toHaveBeenCalledWith(provider, connectionId, 'e1');
      expect(dedupService.clearProcessing).toHaveBeenCalledWith(provider, connectionId, 'e1');
    });
  });

  describe('verify/replay rejection (no row inserted)', () => {
    it('does not insert a row when the signature fails to verify (401)', async () => {
      decoder.verify.mockReturnValue({ ok: false });

      await expect(
        service.processWebhook(provider, connectionId, rawBody, headers),
      ).rejects.toThrow(WebhookAuthenticationException);

      expect(decoder.extractEnvelope).not.toHaveBeenCalled();
      expect(deliveryRepository.insertIfNew).not.toHaveBeenCalled();
    });

    it('does not insert a row when the timestamp is outside the replay window', async () => {
      authService.validateTimestampMs.mockImplementation(() => {
        throw new WebhookReplayException('stale', '0', 120_000);
      });

      await expect(
        service.processWebhook(provider, connectionId, rawBody, headers),
      ).rejects.toThrow(WebhookReplayException);

      expect(decoder.extractEnvelope).not.toHaveBeenCalled();
      expect(deliveryRepository.insertIfNew).not.toHaveBeenCalled();
    });
  });
});
