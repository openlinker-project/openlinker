/**
 * Webhook Status Service Unit Tests
 *
 * @module apps/api/src/integrations/application/services
 */
import type { ConnectionPort, Connection } from '@openlinker/core/identifier-mapping';
import type { WebhookSecretProviderPort } from '@openlinker/core/integrations';
import type { WebhookDelivery, PaginatedWebhookDeliveries } from '@openlinker/core/webhooks';
import { WebhookStatusService } from './webhook-status.service';
import type { IWebhookDeliveryQueryService } from '@openlinker/api/webhooks/application/interfaces/webhook-delivery-query.service.interface';

describe('WebhookStatusService', () => {
  const connectionId = 'conn-1';
  const receivedAt = new Date('2026-07-22T09:14:02.000Z');

  let connectionPort: jest.Mocked<ConnectionPort>;
  let secretProvider: jest.Mocked<WebhookSecretProviderPort>;
  let deliveryQuery: jest.Mocked<IWebhookDeliveryQueryService>;
  let subject: WebhookStatusService;

  const delivery = (signatureValid: boolean | null): WebhookDelivery =>
    ({
      receivedAt,
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

    subject = new WebhookStatusService(connectionPort, secretProvider, deliveryQuery);
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
});
