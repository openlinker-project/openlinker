/**
 * Mock HTTP Client Factory
 *
 * Creates mocked PrestaShop HTTP client for testing adapters and mappers.
 *
 * @module libs/integrations/prestashop/src/__tests__/mocks
 */
// eslint-disable-next-line no-restricted-imports
import { IPrestashopWebserviceClient } from '../../infrastructure/http/prestashop-webservice.client.interface';

export function createMockHttpClient(overrides: Partial<IPrestashopWebserviceClient> = {}): jest.Mocked<IPrestashopWebserviceClient> {
  return {
    getResource: jest.fn(),
    listResources: jest.fn(),
    createResource: jest.fn(),
    ...overrides,
  } as jest.Mocked<IPrestashopWebserviceClient>;
}

