/**
 * Connection Fixtures
 *
 * Sample Connection entities for testing.
 *
 * @module libs/integrations/prestashop/src/__tests__/fixtures
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { PrestashopConnectionConfig } from '@openlinker/integrations-prestashop';

export function createTestConnection(overrides: Partial<Connection> = {}): Connection {
  const defaultConfig: PrestashopConnectionConfig = {
    baseUrl: 'https://shop.example.com',
    shopId: 1,
    langId: 1,
    timeoutMs: 30000,
    pageSize: 100,
    responseFormat: 'auto',
  };

  return {
    id: 'test-connection-id',
    platformType: 'prestashop',
    name: 'Test PrestaShop Store',
    status: 'active',
    config: defaultConfig as unknown as Record<string, unknown>,
    credentialsRef: 'test_credentials',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  } as Connection;
}
