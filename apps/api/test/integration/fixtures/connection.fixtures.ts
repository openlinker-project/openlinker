/**
 * Connection Test Fixtures
 *
 * Reusable test data for connection-related tests.
 *
 * @module apps/api/test/integration/fixtures
 */
import { CreateConnectionDto } from '../../../src/integrations/http/dto/create-connection.dto';

/**
 * Create a valid PrestaShop connection DTO
 */
export function createPrestashopConnectionDto(
  overrides?: Partial<CreateConnectionDto>,
): CreateConnectionDto {
  return {
    platformType: 'prestashop',
    name: 'Test PrestaShop Store',
    config: {
      baseUrl: 'https://shop.example.com',
      shopId: 1,
      langId: 1,
    },
    credentialsRef: 'test-credentials-ref',
    adapterKey: 'prestashop.webservice.v1',
    ...overrides,
  };
}

/**
 * Create a valid Allegro connection DTO
 */
export function createAllegroConnectionDto(
  overrides?: Partial<CreateConnectionDto>,
): CreateConnectionDto {
  return {
    platformType: 'allegro',
    name: 'Test Allegro Account',
    config: {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
    },
    credentialsRef: 'test-allegro-credentials-ref',
    adapterKey: 'allegro.api.v1',
    ...overrides,
  };
}



