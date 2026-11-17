/**
 * AmazonNotificationProvisioningAdapter tests (#4179)
 *
 * @module libs/integrations/amazon/src/infrastructure/adapters/__tests__
 */
import type { ConnectionPort } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { HttpTransportFactoryPort } from '@openlinker/shared/http';

import type { IAmazonAdapterFactory } from '../../../application/interfaces/amazon-adapter.factory.interface';
import { AmazonApiError } from '../../../domain/exceptions/amazon-api.error';
import { AmazonNotificationProvisioningAdapter } from '../amazon-notification-provisioning.adapter';

const ARN = 'arn:aws:sqs:eu-west-1:123456789012:amazon-notifications';
const QUEUE = { url: 'https://sqs.eu-west-1.amazonaws.com/123456789012/amazon-notifications', region: 'eu-west-1', arn: ARN };

function setup(queue: typeof QUEUE | null = QUEUE): {
  adapter: AmazonNotificationProvisioningAdapter;
  seller: { get: jest.Mock; post: jest.Mock };
  grantless: { get: jest.Mock; post: jest.Mock };
} {
  const seller = { get: jest.fn(), post: jest.fn().mockResolvedValue({ status: 200, data: {} }) };
  const grantless = {
    get: jest.fn().mockResolvedValue({ status: 200, data: { payload: [] } }),
    post: jest.fn().mockResolvedValue({ status: 200, data: { payload: { destinationId: 'dest-new' } } }),
  };
  const factory: IAmazonAdapterFactory = {
    resolve: jest.fn().mockResolvedValue({
      config: { region: 'eu', environment: 'production', marketplaceIds: ['A1PA6795UKMFR9'], notificationQueue: queue ?? undefined },
      client: seller,
      notificationsClient: grantless,
    }),
  };
  const adapter = new AmazonNotificationProvisioningAdapter(
    { get: jest.fn().mockResolvedValue({ id: 'conn-amz' }) } as unknown as ConnectionPort,
    {} as CredentialsResolverPort,
    factory,
    { forConnection: jest.fn().mockReturnValue(jest.fn()), evict: jest.fn() } as unknown as HttpTransportFactoryPort,
  );
  return { adapter, seller, grantless };
}

describe('AmazonNotificationProvisioningAdapter', () => {
  it('should create the destination and the ORDER_CHANGE subscription when neither exists', async () => {
    const { adapter, seller, grantless } = setup();
    seller.get.mockRejectedValue(new AmazonApiError(404, 'NotFound', 'none', 'r'));

    await expect(adapter.install('conn-amz')).resolves.toEqual({ webhooksConfigured: true, testPingTriggered: false });

    expect(grantless.post).toHaveBeenCalledWith('/notifications/v1/destinations', {
      name: 'openlinker-conn-amz',
      resourceSpecification: { sqs: { arn: ARN } },
    });
    expect(seller.post).toHaveBeenCalledWith('/notifications/v1/subscriptions/ORDER_CHANGE', {
      payloadVersion: '1.0',
      destinationId: 'dest-new',
      processingDirective: {
        eventFilter: { eventFilterType: 'ORDER_CHANGE', orderChangeTypes: ['OrderStatusChange', 'BuyerRequestedChange'] },
      },
    });
  });

  it('should reuse an existing destination and subscription', async () => {
    const { adapter, seller, grantless } = setup();
    grantless.get.mockResolvedValue({
      status: 200,
      data: { payload: [{ destinationId: 'dest-1', resource: { sqs: { arn: ARN } } }] },
    });
    seller.get.mockResolvedValue({ status: 200, data: { payload: { subscriptionId: 's', destinationId: 'dest-1' } } });

    await expect(adapter.install('conn-amz')).resolves.toMatchObject({ webhooksConfigured: true });
    expect(grantless.post).not.toHaveBeenCalled();
    expect(seller.post).not.toHaveBeenCalled();
  });

  it('should not replace a subscription that points at another destination', async () => {
    const { adapter, seller } = setup();
    seller.get.mockResolvedValue({ status: 200, data: { payload: { subscriptionId: 's', destinationId: 'other' } } });

    const result = await adapter.install('conn-amz');

    expect(result.webhooksConfigured).toBe(false);
    expect(result.warning).toContain('another destination');
    expect(seller.post).not.toHaveBeenCalled();
  });

  it('should report a connection without a queue instead of calling Amazon', async () => {
    const { adapter, grantless } = setup(null);
    const result = await adapter.install('conn-amz');
    expect(result).toMatchObject({ webhooksConfigured: false });
    expect(grantless.get).not.toHaveBeenCalled();
  });
});
