/**
 * Amazon Plugin Descriptor tests (#3741 foundation)
 *
 * Asserts the static manifest (empty capability set until the first adapter
 * lands), static === runtime manifest identity (#575), the registrations
 * `register(host)` makes, and the SDK's uniform refusal of every capability.
 *
 * @module libs/integrations/amazon/src/__tests__
 */
import { isInboundQueueReader } from '@openlinker/core/integrations';
import { isRefundExecutor, isReturnSourceReader } from '@openlinker/core/orders';
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { HostServices } from '@openlinker/plugin-sdk';

import { AmazonIntegrationModule, amazonAdapterManifest, createAmazonPlugin } from '../index';

const connection = { id: 'conn-amz-1', platformType: 'amazon', config: {} } as unknown as Connection;

function registerHost(): { host: HostServices; registries: Record<string, jest.Mock>; scheduler: jest.Mock } {
  const registries = {
    tester: jest.fn(),
    config: jest.fn(),
    credentials: jest.fn(),
    retry: jest.fn(),
    auth: jest.fn(),
    email: jest.fn(),
  };
  const scheduler = jest.fn();
  const host = {
    http: { forConnection: jest.fn(), evict: jest.fn() },
    connectionTesterRegistry: { register: registries.tester },
    connectionConfigShapeValidatorRegistry: { register: registries.config },
    connectionCredentialsShapeValidatorRegistry: { register: registries.credentials },
    retryClassifierRegistry: { register: registries.retry },
    authFailureClassifierRegistry: { register: registries.auth },
    emailNormalizerRegistry: { register: registries.email },
    schedulerTaskRegistry: { register: scheduler },
  } as unknown as HostServices;
  return { host, registries, scheduler };
}

describe('Amazon plugin', () => {
  it('should declare the adapter identity and OrderSource as an opt-in capability', () => {
    expect(amazonAdapterManifest).toMatchObject({
      adapterKey: 'amazon.spapi.v1',
      platformType: 'amazon',
      supportedCapabilities: ['OrderSource', 'OfferManager', 'ProductMaster', 'InventoryMaster', 'ReturnSourceReader', 'CategoryBrowser', 'EanCategoryMatcher', 'OfferCreator'],
      defaultEnabledCapabilities: [],
      buyerDataRetentionDays: 30,
      isDefault: true,
    });
    expect(createAmazonPlugin().manifest).toBe(amazonAdapterManifest);
  });

  it('should register tester, validators and classifiers under the adapter key', () => {
    const { host, registries } = registerHost();
    createAmazonPlugin().register?.(host);

    for (const register of Object.values(registries)) {
      expect(register).toHaveBeenCalledWith('amazon.spapi.v1', expect.anything());
    }
  });

  it('should register the orders poll, off by default', () => {
    const { host, scheduler } = registerHost();
    createAmazonPlugin().register?.(host);

    expect(scheduler).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'amazon-orders-poll',
        jobType: 'marketplace.orders.poll',
        requiredCapability: 'OrderSource',
        enabledDefault: false,
      }),
    );
  });

  it('should build the order source for a connection', async () => {
    const host = {
      credentialsResolver: { get: jest.fn().mockResolvedValue({ clientId: 'c', clientSecret: 's', refreshToken: 'r' }) },
      http: { forConnection: jest.fn().mockReturnValue(jest.fn()), evict: jest.fn() },
    } as unknown as HostServices;
    const amazonConnection = {
      id: 'conn-amz-1',
      platformType: 'amazon',
      config: { marketplaceIds: ['A1PA6795UKMFR9'] },
      credentialsRef: 'db:1',
    } as unknown as Connection;

    const source = await createAmazonPlugin().createCapabilityAdapter<{ listOrderFeed: unknown }>(
      amazonConnection,
      'OrderSource',
      host,
    );
    expect(typeof source.listOrderFeed).toBe('function');
    expect(isReturnSourceReader(source)).toBe(true);
    expect(isRefundExecutor(source)).toBe(false);
  });

  it('should make the order source a refund executor only when the connection opted in (#4184)', async () => {
    const host = {
      credentialsResolver: { get: jest.fn().mockResolvedValue({ clientId: 'c', clientSecret: 's', refreshToken: 'r' }) },
      http: { forConnection: jest.fn().mockReturnValue(jest.fn()), evict: jest.fn() },
    } as unknown as HostServices;
    const amazonConnection = {
      id: 'conn-amz-1',
      platformType: 'amazon',
      config: { marketplaceIds: ['A1PA6795UKMFR9'], refundsEnabled: true },
      credentialsRef: 'db:1',
    } as unknown as Connection;

    const source = await createAmazonPlugin().createCapabilityAdapter<object>(amazonConnection, 'OrderSource', host);

    expect(isRefundExecutor(source)).toBe(true);
  });

  it('should keep the queue reader on a refunding order source when the connection has a queue (#4184)', async () => {
    const host = {
      credentialsResolver: {
        get: jest.fn().mockResolvedValue({
          clientId: 'c',
          clientSecret: 's',
          refreshToken: 'r',
          awsAccessKeyId: 'AKIA',
          awsSecretAccessKey: 'secret',
        }),
      },
      http: { forConnection: jest.fn().mockReturnValue(jest.fn()), evict: jest.fn() },
    } as unknown as HostServices;
    const amazonConnection = {
      id: 'conn-amz-1',
      platformType: 'amazon',
      config: {
        marketplaceIds: ['A1PA6795UKMFR9'],
        refundsEnabled: true,
        notificationQueueUrl: 'https://sqs.eu-west-1.amazonaws.com/123456789012/amazon-notifications',
      },
      credentialsRef: 'db:1',
    } as unknown as Connection;

    const source = await createAmazonPlugin().createCapabilityAdapter<object>(amazonConnection, 'OrderSource', host);

    expect(isRefundExecutor(source)).toBe(true);
    expect(isInboundQueueReader(source)).toBe(true);
    expect(isReturnSourceReader(source)).toBe(true);
  });

  it('should register the returns poll and status sync, off by default (#4184)', () => {
    const { host, scheduler } = registerHost();
    createAmazonPlugin().register?.(host);

    for (const [taskId, jobType] of [
      ['amazon-returns-poll', 'marketplace.returns.poll'],
      ['amazon-returns-status-sync', 'marketplace.returns.statusSync'],
    ]) {
      expect(scheduler).toHaveBeenCalledWith(
        expect.objectContaining({ taskId, jobType, requiredCapability: 'OrderSource', enabledDefault: false }),
      );
    }
  });

  it('should refuse a capability it does not support with the SDK message', async () => {
    const { host } = registerHost();
    await expect(createAmazonPlugin().createCapabilityAdapter(connection, 'ShippingProviderManager', host)).rejects.toThrow(
      /Amazon adapter does not support capability: ShippingProviderManager/,
    );
  });

  it('should build a Nest module', () => {
    expect(AmazonIntegrationModule.module).toBeDefined();
  });
});
