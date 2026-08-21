/**
 * Webhook Service Unit Tests
 *
 * Covers the ADR-021 decoder-dispatch flow (verify → replay → extract), the
 * three-state decode (route / ignore / reject), and the #2280 durable-spine
 * gate: routing at ingress, the single-transaction gate write in its FINAL
 * status, best-effort Redis marks, and the retirement of the #711
 * compensating delete (a pre-commit failure rolls back both rows; after
 * commit nothing deletes). Integration coverage of the full happy path lives
 * in `apps/api/test/integration/webhook-ingestion.int-spec.ts`.
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
import type { WebhookAuthRejectionRepositoryPort } from '@openlinker/core/webhooks';
import { WEBHOOK_AUTH_REJECTION_REPOSITORY_TOKEN } from '@openlinker/core/webhooks';
import type { SyncJobRequest } from '@openlinker/core/sync';
import { WebhookService } from './webhook.service';
import { WebhookAuthService } from './webhook-auth.service';
import { WebhookDedupService } from './webhook-dedup.service';
import { DefaultWebhookDecoder } from '../decoders/default-webhook-decoder';
import { WebhookReplayException } from '../errors/webhook-replay.exception';
import { WebhookAuthenticationException } from '../errors/webhook-authentication.exception';
import { WebhookDecodeException } from '../errors/webhook-decode.exception';
import type { IInboundWebhookRoutingService } from '../interfaces/inbound-webhook-routing.service.interface';
import { INBOUND_WEBHOOK_ROUTING_SERVICE_TOKEN } from '../interfaces/inbound-webhook-routing.service.interface';
import type { IWebhookJobGateService } from '../interfaces/webhook-job-gate.service.interface';
import { WEBHOOK_JOB_GATE_SERVICE_TOKEN } from '../interfaces/webhook-job-gate.service.interface';

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

const routedJob: SyncJobRequest = {
  jobType: 'master.product.syncByExternalId',
  connectionId: '123e4567-e89b-12d3-a456-426614174000',
  payload: { schemaVersion: 1, externalId: '12345', objectType: 'Product' },
  idempotencyKey: 'prestashop:123e4567-e89b-12d3-a456-426614174000:e1',
};

describe('WebhookService (ADR-021 decoder dispatch + #2280 durable-spine gate)', () => {
  let service: WebhookService;
  let authService: jest.Mocked<
    Pick<WebhookAuthService, 'assertConnectionUsable' | 'getSecret' | 'validateTimestampMs'>
  >;
  let decoder: jest.Mocked<InboundWebhookDecoderPort>;
  let decoderRegistry: jest.Mocked<Pick<InboundWebhookDecoderRegistryService, 'get'>>;
  let dedupService: jest.Mocked<
    Pick<WebhookDedupService, 'markProcessing' | 'markDone' | 'clearProcessing'>
  >;
  let inboundRouting: jest.Mocked<IInboundWebhookRoutingService>;
  let jobGate: jest.Mocked<IWebhookJobGateService>;
  let authRejectionRepository: jest.Mocked<WebhookAuthRejectionRepositoryPort>;

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
    inboundRouting = {
      resolveEvent: jest.fn().mockResolvedValue({ kind: 'routed', job: routedJob }),
    };
    jobGate = {
      insertDeliveryWithJob: jest.fn().mockResolvedValue({ isNew: true, jobId: 'job-uuid-1' }),
    };
    authRejectionRepository = {
      recordRejection: jest.fn().mockResolvedValue(undefined),
      find: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookService,
        { provide: WebhookAuthService, useValue: authService },
        { provide: DefaultWebhookDecoder, useValue: decoder },
        { provide: INBOUND_WEBHOOK_DECODER_REGISTRY_TOKEN, useValue: decoderRegistry },
        { provide: WebhookDedupService, useValue: dedupService },
        { provide: INBOUND_WEBHOOK_ROUTING_SERVICE_TOKEN, useValue: inboundRouting },
        { provide: WEBHOOK_JOB_GATE_SERVICE_TOKEN, useValue: jobGate },
        { provide: WEBHOOK_AUTH_REJECTION_REPOSITORY_TOKEN, useValue: authRejectionRepository },
      ],
    }).compile();
    service = module.get(WebhookService);
  });

  describe('subscription-verification handshake', () => {
    it('returns the handshake echo body and short-circuits before verify/routing/gate', async () => {
      const handshakeDecoder: jest.Mocked<InboundWebhookDecoderPort> = {
        ...decoder,
        detectHandshake: jest.fn().mockReturnValue({ verification_code: 'abc123' }),
      };
      decoderRegistry.get.mockReturnValue(handshakeDecoder);

      const result = await service.processWebhook(provider, connectionId, rawBody, headers);

      expect(result).toEqual({ verification_code: 'abc123' });
      expect(handshakeDecoder.verify).not.toHaveBeenCalled();
      expect(inboundRouting.resolveEvent).not.toHaveBeenCalled();
      expect(jobGate.insertDeliveryWithJob).not.toHaveBeenCalled();
    });

    it('proceeds to verify when detectHandshake returns null', async () => {
      const nonHandshakeDecoder: jest.Mocked<InboundWebhookDecoderPort> = {
        ...decoder,
        detectHandshake: jest.fn().mockReturnValue(null),
      };
      decoderRegistry.get.mockReturnValue(nonHandshakeDecoder);

      const result = await service.processWebhook(provider, connectionId, rawBody, headers);

      expect(result).toBeUndefined();
      expect(nonHandshakeDecoder.verify).toHaveBeenCalled();
    });
  });

  describe('decoder dispatch + three-state decode', () => {
    it('routes at ingress and writes the gate row in its final job_enqueued status with the job', async () => {
      await service.processWebhook(provider, connectionId, rawBody, headers);

      expect(authService.assertConnectionUsable).toHaveBeenCalledWith(provider, connectionId);
      expect(decoder.verify).toHaveBeenCalled();
      expect(inboundRouting.resolveEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'e1', provider, connectionId })
      );
      expect(jobGate.insertDeliveryWithJob).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 'e1',
          status: 'job_enqueued',
          externalId: '12345',
          signatureValid: true,
        }),
        routedJob
      );
    });

    it('ignores (202, no gate write) when the decoder returns ignore', async () => {
      decoder.extractEnvelope.mockReturnValue({ action: 'ignore', reason: 'unhandled topic' });

      await service.processWebhook(provider, connectionId, rawBody, headers);

      expect(inboundRouting.resolveEvent).not.toHaveBeenCalled();
      expect(jobGate.insertDeliveryWithJob).not.toHaveBeenCalled();
    });

    it('throws WebhookDecodeException (→400) and writes no row when the decoder rejects', async () => {
      decoder.extractEnvelope.mockReturnValue({ action: 'reject', reason: 'malformed' });

      await expect(
        service.processWebhook(provider, connectionId, rawBody, headers),
      ).rejects.toThrow(WebhookDecodeException);

      expect(jobGate.insertDeliveryWithJob).not.toHaveBeenCalled();
    });
  });

  describe('routing outcomes → durable rows (#2280)', () => {
    it('records a test ping as a received row with no job', async () => {
      inboundRouting.resolveEvent.mockResolvedValue({ kind: 'ping' });

      await service.processWebhook(provider, connectionId, rawBody, headers);

      expect(jobGate.insertDeliveryWithJob).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'received' }),
        null
      );
    });

    it('records a deterministically unroutable event as a deadlettered row with the reason', async () => {
      inboundRouting.resolveEvent.mockResolvedValue({
        kind: 'unroutable',
        reason: 'no-translator: foo.v1',
      });

      await service.processWebhook(provider, connectionId, rawBody, headers);

      expect(jobGate.insertDeliveryWithJob).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'deadlettered', dlqReason: 'no-translator: foo.v1' }),
        null
      );
    });

    it('throws (→ source retry) when routing fails transiently, writing nothing', async () => {
      inboundRouting.resolveEvent.mockRejectedValue(new Error('db blip'));

      await expect(
        service.processWebhook(provider, connectionId, rawBody, headers),
      ).rejects.toThrow('db blip');

      expect(jobGate.insertDeliveryWithJob).not.toHaveBeenCalled();
    });
  });

  describe('Postgres dedup gate', () => {
    it('short-circuits to the idempotent 202 when the gate reports a replay', async () => {
      jobGate.insertDeliveryWithJob.mockResolvedValue({ isNew: false, jobId: 'job-uuid-1' });

      await service.processWebhook(provider, connectionId, rawBody, headers);

      expect(dedupService.markDone).not.toHaveBeenCalled();
    });
  });

  describe('Redis is best-effort, never part of the durable path (#2280)', () => {
    it('still commits the gate when markProcessing throws (Redis down)', async () => {
      dedupService.markProcessing.mockRejectedValue(new Error('redis down'));

      await service.processWebhook(provider, connectionId, rawBody, headers);

      expect(jobGate.insertDeliveryWithJob).toHaveBeenCalledTimes(1);
    });

    it('does not throw — and deletes nothing — when markDone fails after the gate commit', async () => {
      dedupService.markDone.mockRejectedValue(new Error('redis down'));

      await expect(
        service.processWebhook(provider, connectionId, rawBody, headers),
      ).resolves.toBeUndefined();
    });

    it('propagates a gate failure so the source retries (transaction rolled back, nothing to delete)', async () => {
      jobGate.insertDeliveryWithJob.mockRejectedValue(new Error('db down'));

      await expect(
        service.processWebhook(provider, connectionId, rawBody, headers),
      ).rejects.toThrow('db down');
    });
  });

  describe('verify/replay rejection (no row inserted)', () => {
    it('does not write a row when the signature fails to verify (401)', async () => {
      decoder.verify.mockReturnValue({ ok: false });

      await expect(
        service.processWebhook(provider, connectionId, rawBody, headers),
      ).rejects.toThrow(WebhookAuthenticationException);

      expect(decoder.extractEnvelope).not.toHaveBeenCalled();
      expect(jobGate.insertDeliveryWithJob).not.toHaveBeenCalled();
    });

    it('records a durable auth-rejection signal when the signature fails (#1814)', async () => {
      decoder.verify.mockReturnValue({ ok: false });

      await expect(
        service.processWebhook(provider, connectionId, rawBody, headers),
      ).rejects.toThrow(WebhookAuthenticationException);

      expect(authRejectionRepository.recordRejection).toHaveBeenCalledWith({
        provider,
        connectionId,
        reason: 'invalid_signature',
      });
      expect(jobGate.insertDeliveryWithJob).not.toHaveBeenCalled();
    });

    it('still returns 401 when recording the auth-rejection fails (non-fatal, #1814)', async () => {
      decoder.verify.mockReturnValue({ ok: false });
      authRejectionRepository.recordRejection.mockRejectedValueOnce(new Error('db down'));

      await expect(
        service.processWebhook(provider, connectionId, rawBody, headers),
      ).rejects.toThrow(WebhookAuthenticationException);
    });

    it('does not record an auth-rejection when the timestamp is stale (replay, not a secret failure)', async () => {
      authService.validateTimestampMs.mockImplementation(() => {
        throw new WebhookReplayException('stale', '0', 120_000);
      });

      await expect(
        service.processWebhook(provider, connectionId, rawBody, headers),
      ).rejects.toThrow(WebhookReplayException);

      expect(authRejectionRepository.recordRejection).not.toHaveBeenCalled();
    });

    it('does not write a row when the timestamp is outside the replay window', async () => {
      authService.validateTimestampMs.mockImplementation(() => {
        throw new WebhookReplayException('stale', '0', 120_000);
      });

      await expect(
        service.processWebhook(provider, connectionId, rawBody, headers),
      ).rejects.toThrow(WebhookReplayException);

      expect(decoder.extractEnvelope).not.toHaveBeenCalled();
      expect(jobGate.insertDeliveryWithJob).not.toHaveBeenCalled();
    });
  });
});
