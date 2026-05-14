/**
 * Mock Credentials Resolver Factory
 *
 * Creates mocked CredentialsResolverPort for testing factories.
 *
 * @module libs/integrations/prestashop/src/__tests__/mocks
 */
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { PrestashopCredentials } from '@openlinker/integrations-prestashop';

export function createMockCredentialsResolver(
  credentials: PrestashopCredentials = { webserviceApiKey: 'test-api-key' }
): CredentialsResolverPort {
  return {
    get: jest.fn().mockResolvedValue(credentials),
  } as CredentialsResolverPort;
}
