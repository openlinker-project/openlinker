/**
 * Inbound Webhook Routing Service Unit Tests
 *
 * Pins the ingress translate→resolve contract (#2280): pings short-circuit,
 * deterministic faults (missing connection, no translator, undecodable event,
 * capability-ungated domain) classify as `unroutable`, transient faults
 * rethrow (source retry), and a routable event returns the resolved job spec.
 *
 * @module apps/api/src/webhooks/application/services
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { InboundWebhookEvent } from '@openlinker/core/events';
import type {
  IIntegrationsService,
  WebhookEventTranslatorPort,
  WebhookEventTranslatorRegistryService,
} from '@openlinker/core/integrations';
import {
  INTEGRATIONS_SERVICE_TOKEN,
  WEBHOOK_EVENT_TRANSLATOR_REGISTRY_TOKEN,
} from '@openlinker/core/integrations';
import {
  ConnectionNotFoundException,
  ConnectionDisabledException,
} from '@openlinker/core/identifier-mapping';
import type { IInboundRoutingPolicyService, SyncJobRequest } from '@openlinker/core/sync';
import { INBOUND_ROUTING_POLICY_TOKEN } from '@openlinker/core/sync';
import { InboundWebhookRoutingService } from './inbound-webhook-routing.service';

const connectionId = '123e4567-e89b-12d3-a456-426614174000';

function makeEvent(overrides: Partial<InboundWebhookEvent> = {}): InboundWebhookEvent {
  return {
    eventId: 'e1',
    provider: 'prestashop',
    connectionId,
    eventType: 'product.saved',
    occurredAt: '2026-06-08T10:00:00.000Z',
    receivedAt: '2026-06-08T10:00:01.000Z',
    objectType: 'product',
    externalId: '12345',
    payload: {},
    ...overrides,
  };
}

const resolvedJob: SyncJobRequest = {
  jobType: 'master.product.syncByExternalId',
  connectionId,
  payload: { schemaVersion: 1, externalId: '12345', objectType: 'Product' },
  idempotencyKey: `prestashop:${connectionId}:e1`,
};

describe('InboundWebhookRoutingService', () => {
  let service: InboundWebhookRoutingService;
  let integrationsService: jest.Mocked<Pick<IIntegrationsService, 'getAdapter'>>;
  let translatorRegistry: jest.Mocked<Pick<WebhookEventTranslatorRegistryService, 'get'>>;
  let routingPolicy: jest.Mocked<Pick<IInboundRoutingPolicyService, 'resolve'>>;
  let translator: jest.Mocked<WebhookEventTranslatorPort>;

  beforeEach(async () => {
    translator = {
      translate: jest.fn().mockReturnValue({
        domain: 'product',
        action: 'upsert',
        externalId: '12345',
        occurredAt: '2026-06-08T10:00:00.000Z',
      }),
    };
    integrationsService = {
      getAdapter: jest.fn().mockResolvedValue({
        connection: { id: connectionId, platformType: 'prestashop' },
        metadata: {
          adapterKey: 'prestashop.webservice.v1',
          supportedCapabilities: ['ProductMaster'],
        },
        adapter: {},
      }),
    };
    translatorRegistry = { get: jest.fn().mockReturnValue(translator) };
    routingPolicy = {
      resolve: jest.fn().mockReturnValue({ status: 'resolved', job: resolvedJob }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InboundWebhookRoutingService,
        { provide: INTEGRATIONS_SERVICE_TOKEN, useValue: integrationsService },
        { provide: WEBHOOK_EVENT_TRANSLATOR_REGISTRY_TOKEN, useValue: translatorRegistry },
        { provide: INBOUND_ROUTING_POLICY_TOKEN, useValue: routingPolicy },
      ],
    }).compile();
    service = module.get(InboundWebhookRoutingService);
  });

  it('returns routed with the resolved job for a routable event', async () => {
    const outcome = await service.resolveEvent(makeEvent());

    expect(outcome).toEqual({ kind: 'routed', job: resolvedJob });
    expect(routingPolicy.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'product' }),
      expect.objectContaining({ id: connectionId }),
      ['ProductMaster'],
      'e1'
    );
  });

  it('short-circuits test.* events to ping before touching the connection', async () => {
    const outcome = await service.resolveEvent(makeEvent({ eventType: 'test.ping' }));

    expect(outcome).toEqual({ kind: 'ping' });
    expect(integrationsService.getAdapter).not.toHaveBeenCalled();
  });

  it('classifies a missing connection as unroutable (durable dead-letter, not retry)', async () => {
    integrationsService.getAdapter.mockRejectedValue(new ConnectionNotFoundException(connectionId));

    const outcome = await service.resolveEvent(makeEvent());

    expect(outcome).toMatchObject({ kind: 'unroutable' });
    expect((outcome as { reason: string }).reason).toContain('connection-unavailable');
  });

  it('classifies a disabled connection as unroutable', async () => {
    integrationsService.getAdapter.mockRejectedValue(new ConnectionDisabledException(connectionId));

    const outcome = await service.resolveEvent(makeEvent());

    expect(outcome).toMatchObject({ kind: 'unroutable' });
  });

  it('rethrows any other adapter-resolution error so the source retries (ADR-015 invariant 3)', async () => {
    integrationsService.getAdapter.mockRejectedValue(new Error('db blip'));

    await expect(service.resolveEvent(makeEvent())).rejects.toThrow('db blip');
  });

  it('classifies a plugin with no translator as unroutable, naming the adapterKey', async () => {
    translatorRegistry.get.mockReturnValue(undefined);

    const outcome = await service.resolveEvent(makeEvent());

    expect(outcome).toEqual({
      kind: 'unroutable',
      reason: 'no-translator: prestashop.webservice.v1',
    });
  });

  it('classifies a null translation as unroutable (undecodable event)', async () => {
    translator.translate.mockReturnValue(null);

    const outcome = await service.resolveEvent(makeEvent());

    expect(outcome).toMatchObject({ kind: 'unroutable' });
    expect((outcome as { reason: string }).reason).toContain('undecodable');
  });

  it('classifies a capability-ungated domain as unroutable, naming the missing capability', async () => {
    routingPolicy.resolve.mockReturnValue({
      status: 'ungated',
      domain: 'order',
      requiredCapability: 'OrderSource',
    });

    const outcome = await service.resolveEvent(makeEvent());

    expect(outcome).toEqual({
      kind: 'unroutable',
      reason: 'ungated: product requires OrderSource',
    });
  });
});
