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
    credentialsRef: 'db:test-credentials-ref',
    adapterKey: 'prestashop.webservice.v1',
    ...overrides,
  };
}

/**
 * Create a PrestaShop connection DTO that asks the API to persist credentials
 * (the wizard path). Mutually exclusive with `credentialsRef`.
 */
export function createPrestashopWizardConnectionDto(
  overrides?: Partial<CreateConnectionDto>,
): CreateConnectionDto {
  const { credentialsRef: _ignore, ...base } = createPrestashopConnectionDto();
  return {
    ...base,
    credentials: { webserviceApiKey: 'WS_KEY_TEST' },
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
    credentialsRef: 'db:test-allegro-credentials-ref',
    adapterKey: 'allegro.api.v1',
    ...overrides,
  };
}






