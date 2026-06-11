/**
 * WooCommerce Test Connection Helper (#878)
 *
 * Creates WooCommerce Connection + IntegrationCredential rows for integration
 * test specs. Follows the pattern of createTestPrestashopDestinationConnection
 * in test-connection.helper.ts — encrypts credentials via seedIntegrationCredential
 * (same path as production CredentialStorageService).
 *
 * @module apps/api/test/integration/helpers
 */
import { randomUUID } from 'crypto';
import type { DataSource } from 'typeorm';
import { encryptWithKey, loadEncryptionKey } from '@openlinker/shared';
import { ConnectionOrmEntity } from '@openlinker/core/identifier-mapping/orm-entities';
import { IntegrationCredentialOrmEntity } from '@openlinker/core/integrations/orm-entities';

export interface CreateWooCommerceConnectionOpts {
  /** Base URL of the WC store, e.g. http://localhost:32768 (from Testcontainer) */
  siteUrl: string;
  /** WC REST API consumer_key (ck_ prefix) */
  consumerKey: string;
  /** WC REST API consumer_secret (cs_ prefix) */
  consumerSecret: string;
  /** Capabilities to enable. Default: ['ProductMaster', 'InventoryMaster', 'OrderProcessorManager'] */
  enabledCapabilities?: string[];
  /** Connection name. Default: 'Test WooCommerce' */
  name?: string;
}

/**
 * Create a WooCommerce connection with encrypted credentials in the test database.
 * Uses the same encryption path as production so downstream
 * CredentialStorageService.get() round-trips correctly.
 */
export async function createTestWooCommerceConnection(
  dataSource: DataSource,
  opts: CreateWooCommerceConnectionOpts,
): Promise<ConnectionOrmEntity> {
  const credentialsRef = `test-woocommerce-${randomUUID()}`;

  const { key } = loadEncryptionKey(process.env);
  const credRepo = dataSource.getRepository(IntegrationCredentialOrmEntity);
  await credRepo.save(
    credRepo.create({
      ref: credentialsRef,
      platformType: 'woocommerce',
      credentialsCiphertext: encryptWithKey(
        key,
        JSON.stringify({ consumerKey: opts.consumerKey, consumerSecret: opts.consumerSecret }),
      ),
    }),
  );

  const connRepo = dataSource.getRepository(ConnectionOrmEntity);
  return connRepo.save(
    connRepo.create({
      platformType: 'woocommerce',
      name: opts.name ?? 'Test WooCommerce',
      status: 'active',
      config: { siteUrl: opts.siteUrl },
      credentialsRef: `db:${credentialsRef}`,
      adapterKey: 'woocommerce.restapi.v3',
      enabledCapabilities: opts.enabledCapabilities ?? [
        'ProductMaster',
        'InventoryMaster',
        'OrderProcessorManager',
      ],
    }),
  );
}
