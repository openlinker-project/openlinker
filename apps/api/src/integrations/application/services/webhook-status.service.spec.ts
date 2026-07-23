/**
 * Webhook Status Service Unit Tests
 *
 * @module apps/api/src/integrations/application/services
 */
import type { ConnectionPort, Connection } from '@openlinker/core/identifier-mapping';
import type { WebhookSecretProviderPort } from '@openlinker/core/integrations';
import type {
  WebhookDelivery,
  PaginatedWebhookDeliveries,
  WebhookAuthRejection,
  WebhookAuthRejectionRepositoryPort,
} from '@openlinker/core/webhooks';
import { WebhookStatusService } from './webhook-status.service';
import type { IWebhookDeliveryQueryService } from '@openlinker/api/webhooks/application/interfaces/webhook-delivery-query.service.interface';

describe('WebhookStatusService', () => {
  const connectionId = 'conn-1';
  const receivedAt = new Date('2026-07-22T09:14:02.000Z');

  let connectionPort: jest.Mocked<ConnectionPort>;
  let secretProvider: jest.Mocked<WebhookSecretProviderPort>;
  let deliveryQuery: jest.Mocked<IWebhookDeliveryQueryService>;
  let authRejectionRepository: jest.Mocked<WebhookAuthRejectionRepositoryPort>;
  let subject: WebhookStatusService;

  const rejection = (lastRejectedAt: Date): WebhookAuthRejection =>
    ({
      provider: 'infakt',
      connectionId,
      rejectionCount: 3,
      firstRejectedAt: lastRejectedAt,
      lastRejectedAt,
      lastReason: 'invalid_signature',
    }) as WebhookAuthRejection;

  const delivery = (signatureValid: boolean | null, at: Date = receivedAt): WebhookDelivery =>
    ({
      receivedAt: at,
      eventType: 'send_to_ksef_success',
      status: 'published',
      signatureValid,
    }) as WebhookDelivery;

  const page = (items: WebhookDelivery[]): PaginatedWebhookDeliveries => ({
    items,
    total: items.length,
  });

  beforeEach(() => {
    connectionPort = {
      get: jest.fn().mockResolvedValue({ platformType: 'infakt' } as Connection),
    } as never;
    secretProvider = { getSecret: jest.fn(), has: jest.fn(), invalidate: jest.fn() } as never;
    deliveryQuery = { list: jest.fn(), getById: jest.fn() } as never;
    authRejectionRepository = {
      recordRejection: jest.fn(),
      find: jest.fn().mockResolvedValue(null),
    } as never;

    subject = new WebhookStatusService(
      connectionPort,
      secretProvider,
      deliveryQuery,
      authRejectionRepository
    );
  });

  it('reports not-registered + off when no deliveries and no secret', async () => {
    deliveryQuery.list.mockResolvedValue(page([]));
    secretProvider.has.mockResolvedValue(false);

    const status = await subject.getStatus(connectionId);

    expect(status).toEqual({
      activation: 'not-registered',
      signature: 'off',
      lastDeliveryAt: null,
      lastDeliveryEvent: null,
      lastDeliveryResult: null,
    });
    expect(deliveryQuery.list).toHaveBeenCalledWith(
      { provider: 'infakt', connectionId },
      { limit: 1, offset: 0 }
    );
  });

  it('reports verified + configured with last-delivery summary', async () => {
    deliveryQuery.list.mockResolvedValue(page([delivery(true)]));
    secretProvider.has.mockResolvedValue(true);

    const status = await subject.getStatus(connectionId);

    expect(status).toEqual({
      activation: 'verified',
      signature: 'configured',
      lastDeliveryAt: '2026-07-22T09:14:02.000Z',
      lastDeliveryEvent: 'send_to_ksef_success',
      lastDeliveryResult: 'published',
    });
  });

  it('reports configured when a secret is stored, regardless of the recorded delivery (#1770 review)', async () => {
    // `signatureValid` is only ever recorded as `true` (a failed check is
    // rejected before any row is written) - `signature` derives from
    // `hasSecret` alone. `delivery(false)` here documents that a
    // hypothetically-false stored value still doesn't flip the result.
    deliveryQuery.list.mockResolvedValue(page([delivery(false)]));
    secretProvider.has.mockResolvedValue(true);

    const status = await subject.getStatus(connectionId);

    expect(status.signature).toBe('configured');
    expect(status.activation).toBe('verified');
  });

  it('reports off when no secret is stored', async () => {
    deliveryQuery.list.mockResolvedValue(page([delivery(true)]));
    secretProvider.has.mockResolvedValue(false);

    const status = await subject.getStatus(connectionId);

    expect(status.signature).toBe('off');
  });

  describe('auth-failing activation (#1814)', () => {
    it('reports auth-failing when a recent rejection exists and no delivery has landed', async () => {
      deliveryQuery.list.mockResolvedValue(page([]));
      secretProvider.has.mockResolvedValue(false);
      authRejectionRepository.find.mockResolvedValue(rejection(new Date()));

      const status = await subject.getStatus(connectionId);

      expect(status.activation).toBe('auth-failing');
    });

    it('reports auth-failing when the last rejection is newer than the last verified delivery', async () => {
      // Both recent (within the 24h window): a good delivery 5 min ago, then the
      // secret broke and a rejection landed 1 min ago.
      const deliveredAt = new Date(Date.now() - 5 * 60_000);
      deliveryQuery.list.mockResolvedValue(page([delivery(true, deliveredAt)]));
      secretProvider.has.mockResolvedValue(true);
      authRejectionRepository.find.mockResolvedValue(rejection(new Date(Date.now() - 60_000)));

      const status = await subject.getStatus(connectionId);

      expect(status.activation).toBe('auth-failing');
    });

    it('reports verified when a delivery is newer than the last rejection (self-healed)', async () => {
      // rejection before the successful delivery — operator fixed the secret.
      const deliveredAt = new Date(Date.now() - 60_000);
      deliveryQuery.list.mockResolvedValue(page([delivery(true, deliveredAt)]));
      secretProvider.has.mockResolvedValue(true);
      authRejectionRepository.find.mockResolvedValue(
        rejection(new Date(deliveredAt.getTime() - 60_000))
      );

      const status = await subject.getStatus(connectionId);

      expect(status.activation).toBe('verified');
    });

    it('reports not-registered when the only rejection is stale (outside the freshness window)', async () => {
      deliveryQuery.list.mockResolvedValue(page([]));
      secretProvider.has.mockResolvedValue(false);
      authRejectionRepository.find.mockResolvedValue(
        rejection(new Date(Date.now() - 48 * 60 * 60 * 1000))
      );

      const status = await subject.getStatus(connectionId);

      expect(status.activation).toBe('not-registered');
    });
  });
});
