/**
 * Inbound Webhook Routing Service Unit Tests
 *
 * Pins the ingress translate→resolve contract (#2280): pings short-circuit,
 * deterministic faults (missing connection, no translator, undecodable event,
 * capability-ungated domain) classify as `unroutable`, transient faults
 * rethrow (source retry), and a routable event returns the resolved job spec.
 * A translator returning several events fans out into several jobs, the
 * primary keeping the unchanged three-part idempotency key.
 *
 * @module apps/api/src/webhooks/application/services
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { InboundWebhookEvent } from '@openlinker/core/events';
import type {
  CanonicalInboundEvent,
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
import type {
  IInboundRoutingPolicyService,
  InboundRouteResolution,
  SyncJobRequest,
} from '@openlinker/core/sync';
import { INBOUND_ROUTING_POLICY_TOKEN } from '@openlinker/core/sync';
import { InboundWebhookRoutingService } from './inbound-webhook-routing.service';
import { WebhookRoutingUnavailableException } from '../errors/webhook-routing-unavailable.exception';

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

  it('should return routed with the resolved job unchanged when the translator returns a single event', async () => {
    const outcome = await service.resolveEvent(makeEvent());

    expect(outcome).toEqual({ kind: 'routed', jobs: [resolvedJob] });
    // The single-event key must stay byte-identical: the lookup endpoint and
    // the frontend rebuild exactly this form.
    expect(outcome.kind === 'routed' && outcome.jobs[0].idempotencyKey).toBe(
      `prestashop:${connectionId}:e1`
    );
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

  it('rethrows any other adapter-resolution error TYPED, so the controller answers 503 not 404', async () => {
    // An untyped rethrow fell through the controller's legacy message matcher:
    // `AdapterNotFoundException` reads "Adapter not found: …" and became a 404,
    // which a marketplace commonly answers by deleting the subscription.
    integrationsService.getAdapter.mockRejectedValue(new Error('Adapter not found: foo.v1'));

    await expect(service.resolveEvent(makeEvent())).rejects.toBeInstanceOf(
      WebhookRoutingUnavailableException
    );
    await expect(service.resolveEvent(makeEvent())).rejects.toThrow(/Adapter not found/);
  });

  it('dead-letters a THROWING translator rather than 5xx-ing forever with no record', async () => {
    // Deterministic about this payload: it throws identically on every
    // redelivery, so rethrowing would be ADR-049's poison-entry gap moved onto
    // the request path — a permanent 5xx with nothing durable anywhere.
    translator.translate.mockImplementation(() => {
      throw new Error('unexpected shape');
    });

    const outcome = await service.resolveEvent(makeEvent());

    expect(outcome).toMatchObject({ kind: 'unroutable' });
    expect((outcome as { reason: string }).reason).toContain('translator-threw');
    expect((outcome as { reason: string }).reason).toContain('unexpected shape');
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

  describe('fan-out (one delivery, several canonical events)', () => {
    const productEvent: CanonicalInboundEvent = {
      domain: 'product',
      externalId: '23',
      eventType: 'product.edit',
    };
    const inventoryEvent: CanonicalInboundEvent = {
      domain: 'inventory',
      externalId: '23',
      eventType: 'product.edit',
    };
    const productJob: SyncJobRequest = {
      jobType: 'master.product.syncByExternalId',
      connectionId,
      payload: { schemaVersion: 1, externalId: '23', objectType: 'Product' },
      idempotencyKey: `prestashop:${connectionId}:e1`,
    };
    const inventoryJob: SyncJobRequest = {
      jobType: 'master.inventory.syncByExternalId',
      connectionId,
      payload: { schemaVersion: 1, externalId: '23', objectType: 'Inventory' },
      // The policy always stamps the base key; the routing service re-keys it.
      idempotencyKey: `prestashop:${connectionId}:e1`,
    };

    /** Policy stub resolving by domain, with a configurable set of gated domains. */
    function resolveByDomain(
      gated: readonly string[] = []
    ): (event: CanonicalInboundEvent) => InboundRouteResolution {
      return (event) => {
        if (gated.includes(event.domain)) {
          return {
            status: 'ungated',
            domain: event.domain,
            requiredCapability: event.domain === 'product' ? 'ProductMaster' : 'InventoryMaster',
          };
        }
        return { status: 'resolved', job: event.domain === 'product' ? productJob : inventoryJob };
      };
    }

    it('should route every resolvable event when the translator returns two', async () => {
      translator.translate.mockReturnValue([productEvent, inventoryEvent]);
      routingPolicy.resolve.mockImplementation(resolveByDomain());

      const outcome = await service.resolveEvent(makeEvent());

      expect(outcome).toEqual({
        kind: 'routed',
        jobs: [
          productJob,
          {
            ...inventoryJob,
            idempotencyKey: `prestashop:${connectionId}:e1:master.inventory.syncByExternalId`,
          },
        ],
      });
      expect(routingPolicy.resolve).toHaveBeenCalledTimes(2);
    });

    it('should still route the secondary job, keeping its discriminated key, when the primary is ungated', async () => {
      translator.translate.mockReturnValue([productEvent, inventoryEvent]);
      routingPolicy.resolve.mockImplementation(resolveByDomain(['product']));

      const outcome = await service.resolveEvent(makeEvent());

      // Positional key: the inventory job keeps its own key rather than taking
      // over the base key, so a later redelivery with the primary ungated
      // cannot collide with it.
      expect(outcome).toEqual({
        kind: 'routed',
        jobs: [
          {
            ...inventoryJob,
            idempotencyKey: `prestashop:${connectionId}:e1:master.inventory.syncByExternalId`,
          },
        ],
      });
    });

    it('should drop the gated secondary and keep the primary when only the secondary is ungated', async () => {
      translator.translate.mockReturnValue([productEvent, inventoryEvent]);
      routingPolicy.resolve.mockImplementation(resolveByDomain(['inventory']));

      const outcome = await service.resolveEvent(makeEvent());

      expect(outcome).toEqual({ kind: 'routed', jobs: [productJob] });
    });

    it('should classify the delivery as unroutable, naming every ungated domain, when no event resolves', async () => {
      translator.translate.mockReturnValue([productEvent, inventoryEvent]);
      routingPolicy.resolve.mockImplementation(resolveByDomain(['product', 'inventory']));

      const outcome = await service.resolveEvent(makeEvent());

      expect(outcome).toEqual({
        kind: 'unroutable',
        reason: 'ungated: product requires ProductMaster; inventory requires InventoryMaster',
      });
    });

    it('should classify the delivery as undecodable when the translator returns an empty array', async () => {
      translator.translate.mockReturnValue([]);

      const outcome = await service.resolveEvent(makeEvent());

      expect(outcome).toMatchObject({ kind: 'unroutable' });
      expect((outcome as { reason: string }).reason).toContain('undecodable');
      expect(routingPolicy.resolve).not.toHaveBeenCalled();
    });

    it('should keep only the first job when two events route to the same job type', async () => {
      translator.translate.mockReturnValue([productEvent, { ...productEvent, externalId: '99' }]);
      routingPolicy.resolve.mockImplementation(resolveByDomain());

      const outcome = await service.resolveEvent(makeEvent());

      expect(outcome).toEqual({ kind: 'routed', jobs: [productJob] });
    });
  });
});
