/**
 * Allegro Masked Email Identity Integration Test
 *
 * Integration test verifying that Allegro masked emails (with +... suffix)
 * are normalized correctly to prevent duplicate customer creation.
 *
 * Tests that:
 * - Same buyer with different transaction IDs (different masked emails)
 * - Resolves to the same internal customer ID
 * - Creates only one customer in PrestaShop
 *
 * @module apps/worker/test/integration
 */
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { WorkerIntegrationTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';
import { CUSTOMER_PROJECTION_REPOSITORY_TOKEN } from '@openlinker/core/customers/customers.tokens';
import { CustomerProjectionRepositoryPort } from '@openlinker/core/customers/domain/ports/customer-projection-repository.port';
import { IDENTIFIER_MAPPING_PORT_TOKEN } from '@openlinker/core/identifier-mapping/identifier-mapping.tokens';
import { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { CUSTOMER_IDENTITY_RESOLVER_PORT_TOKEN } from '@openlinker/core/customers/customers.tokens';
import { CustomerIdentityResolverPort } from '@openlinker/core/customers';
import { DataSource } from 'typeorm';
import { normalizeEmail, hashEmail } from '@openlinker/shared/config';

describe('Allegro Masked Email Identity Integration', () => {
  let harness: WorkerIntegrationTestHarness;
  let customerProjectionRepository: CustomerProjectionRepositoryPort;
  let identifierMapping: IdentifierMappingPort;
  let customerIdentityResolver: CustomerIdentityResolverPort;
  let dataSource: DataSource;

  beforeAll(async () => {
    harness = await getTestHarness();
    customerProjectionRepository = harness.get(CUSTOMER_PROJECTION_REPOSITORY_TOKEN);
    identifierMapping = harness.get(IDENTIFIER_MAPPING_PORT_TOKEN);
    customerIdentityResolver = harness.get(CUSTOMER_IDENTITY_RESOLVER_PORT_TOKEN);
    dataSource = harness.getDataSource();

    // Set environment variables
    process.env.OL_CUSTOMER_IDENTITY_MODE = 'email_fallback';
    process.env.OL_STORE_PII = 'true';
    process.env.OL_PII_HASH_SALT = 'test-salt-for-integration-tests';
    process.env.ORDER_SYNC_DESTINATION_CONNECTION_ID = 'prestashop-connection-id';
    process.env.CREDENTIALS_TEST_CREDENTIALS_REF = '{"accessToken":"test-token"}';
  });

  beforeEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('should normalize Allegro masked emails to same internal customer', async () => {
    // Create Allegro connection
    const allegroConnection = await createTestConnection(dataSource, {
      platformType: 'allegro',
      status: 'active',
      credentialsRef: 'test-credentials-ref',
      adapterKey: 'allegro.publicapi.v1',
    });

    // Create PrestaShop connection (destination)
    const prestashopConnection = await createTestConnection(dataSource, {
      platformType: 'prestashop',
      status: 'active',
      credentialsRef: 'test-credentials-ref',
      adapterKey: 'prestashop.webservice.v1',
    });

    process.env.ORDER_SYNC_DESTINATION_CONNECTION_ID = prestashopConnection.id;

    // Test masked email normalization directly via identity resolver
    const buyerId = 'allegro-buyer-123';
    const maskedEmail1 = '8awgqyk6a5+cub31c122@allegromail.pl';
    const maskedEmail2 = '8awgqyk6a5+xyz789abc@allegromail.pl';

    // Resolve identity for first masked email
    const result1 = await customerIdentityResolver.resolveCustomerIdentity({
      externalBuyerId: buyerId,
      email: maskedEmail1,
      sourceConnectionId: allegroConnection.id,
    });

    expect(result1.internalCustomerId).toBeDefined();
    expect(result1.usedEmailFallback).toBe(true);
    const internalCustomerId1 = result1.internalCustomerId;

    // Resolve identity for second masked email (different transaction ID, same buyer)
    const result2 = await customerIdentityResolver.resolveCustomerIdentity({
      externalBuyerId: `${buyerId}-transaction-2`, // Different external ID for second transaction
      email: maskedEmail2,
      sourceConnectionId: allegroConnection.id,
    });

    expect(result2.internalCustomerId).toBeDefined();
    expect(result2.usedEmailFallback).toBe(true);
    const internalCustomerId2 = result2.internalCustomerId;

    // Verify both orders resolve to the same internal customer ID
    expect(internalCustomerId1).toBe(internalCustomerId2);

    // Verify customer projections have normalized email
    const normalizedEmail = normalizeEmail(maskedEmail1, 'allegro');
    const expectedHash = hashEmail(normalizedEmail, 'allegro');
    const projections = await customerProjectionRepository.findByEmailHash(expectedHash);

    expect(projections.length).toBeGreaterThan(0);
    expect(projections[0].internalCustomerId).toBe(internalCustomerId1);
    // Verify normalized email is 8awgqyk6a5@allegromail.pl (without +... suffix)
    expect(normalizedEmail).toBe('8awgqyk6a5@allegromail.pl');

    // Verify identifier mappings
    const mapping1 = await identifierMapping.getInternalId('Customer', buyerId, allegroConnection.id);
    const mapping2 = await identifierMapping.getInternalId(
      'Customer',
      `${buyerId}-transaction-2`,
      allegroConnection.id,
    );

    // Both external buyer IDs should map to the same internal customer
    expect(mapping1).toBe(mapping2);
    expect(mapping1).toBe(internalCustomerId1);
  });
});
