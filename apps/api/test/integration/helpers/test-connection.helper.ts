/**
 * Connection Test Helpers
 *
 * Utilities for creating test Connection + IntegrationCredential rows used
 * by integration specs. The `createTestConnection` / `createTestConnections`
 * exports here predate the carrier-mapping vertical-slice spec (#506 / #535)
 * and remain in use elsewhere; the `createTestAllegroSourceConnection` /
 * `createTestPrestashopDestinationConnection` / `seedCarrierMapping` exports
 * are scoped to the Allegro → PrestaShop carrier-mapping flow (#535).
 *
 * @module apps/api/test/integration/helpers
 */
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { ConnectionOrmEntity } from '@openlinker/core/identifier-mapping/orm-entities';
import { IntegrationCredentialOrmEntity } from '@openlinker/core/integrations/orm-entities';
import { MAPPING_CONFIG_SERVICE_TOKEN, IMappingConfigService } from '@openlinker/core/mappings';
import type { IntegrationTestHarness } from '../setup';

/**
 * Create a test connection in the database
 *
 * Helper to create a connection entity directly in the database for testing.
 */
export async function createTestConnection(
  dataSource: DataSource,
  overrides?: Partial<ConnectionOrmEntity>,
): Promise<ConnectionOrmEntity> {
  const repository = dataSource.getRepository(ConnectionOrmEntity);

  const connection = repository.create({
    platformType: 'prestashop',
    name: 'Test Connection',
    status: 'active',
    config: { baseUrl: 'https://shop.example.com' },
    credentialsRef: 'db:test-credentials-ref',
    adapterKey: 'prestashop.webservice.v1',
    ...overrides,
  });

  return repository.save(connection);
}

/**
 * Create multiple test connections
 *
 * Helper to create multiple connections for testing filtering, etc.
 */
export async function createTestConnections(
  dataSource: DataSource,
  count: number,
  overrides?: Partial<ConnectionOrmEntity>,
): Promise<ConnectionOrmEntity[]> {
  const connections: ConnectionOrmEntity[] = [];

  for (let i = 0; i < count; i++) {
    const connection = await createTestConnection(dataSource, {
      name: `Test Connection ${i + 1}`,
      ...overrides,
    });
    connections.push(connection);
  }

  return connections;
}

// ─────────────────────────────────────────────────────────────────────────
// Carrier-mapping vertical-slice helpers (#535)
// ─────────────────────────────────────────────────────────────────────────

export interface CreateTestAllegroSourceConnectionOpts {
  /** Adapter key the test stub registered (e.g. `'allegro.test.v1'`). */
  adapterKey: string;
  /** Platform type — typically `'allegro'` even for the stub, so realistic. */
  platformType: string;
  /** Defaults to `['OrderSource']`. */
  enabledCapabilities?: string[];
  /** Defaults to `'Test Allegro source'`. */
  name?: string;
}

/**
 * Create an Allegro connection wired to a test adapterKey + capability.
 *
 * The stub adapter never inspects credentials, so the credentialsRef points
 * at a dummy `integration_credentials` row to keep referential integrity in
 * case any code path validates it.
 */
export async function createTestAllegroSourceConnection(
  dataSource: DataSource,
  opts: CreateTestAllegroSourceConnectionOpts,
): Promise<ConnectionOrmEntity> {
  const credentialsRef = `test-allegro-${randomUUID()}`;
  await seedIntegrationCredential(dataSource, {
    ref: credentialsRef,
    platformType: opts.platformType,
    credentialsJson: { note: 'integration-test stub — not consumed by adapter' },
  });

  const repo = dataSource.getRepository(ConnectionOrmEntity);
  return repo.save(
    repo.create({
      platformType: opts.platformType,
      name: opts.name ?? 'Test Allegro source',
      status: 'active',
      config: {},
      credentialsRef: `db:${credentialsRef}`,
      adapterKey: opts.adapterKey,
      enabledCapabilities: opts.enabledCapabilities ?? ['OrderSource'],
    }),
  );
}

export interface CreateTestPrestashopDestinationConnectionOpts {
  baseUrl: string;
  webserviceApiKey: string;
  /** Optional default carrier id; consumed by the carrier-resolution chain (#516 step 2). */
  defaultCarrierId?: number;
  /** Defaults to `['OrderProcessorManager']`. */
  enabledCapabilities?: string[];
  /** Defaults to `'Test PrestaShop destination'`. */
  name?: string;
}

/**
 * Create a PrestaShop destination connection pointed at a running test container.
 *
 * Writes the WS API key into an `integration_credentials` row under a
 * random `db:test-prestashop-…` ref so every spec run uses a fresh key.
 */
export async function createTestPrestashopDestinationConnection(
  dataSource: DataSource,
  opts: CreateTestPrestashopDestinationConnectionOpts,
): Promise<ConnectionOrmEntity> {
  const credentialsRef = `test-prestashop-${randomUUID()}`;
  await seedIntegrationCredential(dataSource, {
    ref: credentialsRef,
    platformType: 'prestashop',
    credentialsJson: { webserviceApiKey: opts.webserviceApiKey },
  });

  const config: Record<string, unknown> = { baseUrl: opts.baseUrl };
  if (opts.defaultCarrierId !== undefined) {
    config.defaultCarrierId = opts.defaultCarrierId;
  }

  const repo = dataSource.getRepository(ConnectionOrmEntity);
  return repo.save(
    repo.create({
      platformType: 'prestashop',
      name: opts.name ?? 'Test PrestaShop destination',
      status: 'active',
      config,
      credentialsRef: `db:${credentialsRef}`,
      adapterKey: 'prestashop.webservice.v1',
      enabledCapabilities: opts.enabledCapabilities ?? ['OrderProcessorManager'],
    }),
  );
}

/**
 * Seed an `integration_credentials` row directly. Bypasses the encrypted-write
 * path on purpose — test credentials never need to go through encryption.
 */
async function seedIntegrationCredential(
  dataSource: DataSource,
  args: {
    ref: string;
    platformType: string;
    credentialsJson: Record<string, unknown>;
  },
): Promise<void> {
  const repo = dataSource.getRepository(IntegrationCredentialOrmEntity);
  await repo.save(
    repo.create({
      ref: args.ref,
      platformType: args.platformType,
      credentialsJson: args.credentialsJson,
      encrypted: false,
    }),
  );
}

/**
 * Seed a carrier mapping via the public `MappingConfigService.upsertCarrierMappings`
 * API — same code path the FE config screen uses, so contract drift surfaces here.
 *
 * `prestashopCarrierId` is passed as a string (the mapping table stores it as text);
 * the PS order-processor adapter parses it back to an int and writes it directly
 * as `id_carrier` on the cart/order. On a fresh PS install default carriers have
 * `id_carrier == id_reference`, so the int-spec passes whichever value the test
 * fixture exposes.
 */
export async function seedCarrierMapping(
  harness: IntegrationTestHarness,
  sourceConnectionId: string,
  allegroDeliveryMethodId: string,
  prestashopCarrierId: string,
): Promise<void> {
  const mappingConfig = harness.getApp().get<IMappingConfigService>(MAPPING_CONFIG_SERVICE_TOKEN);
  await mappingConfig.upsertCarrierMappings(sourceConnectionId, [
    {
      allegroDeliveryMethodId,
      prestashopCarrierId,
    },
  ]);
}
