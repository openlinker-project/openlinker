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
import { encryptWithKey, loadEncryptionKey } from '@openlinker/shared';
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
 * Delete a connection row created by `createTestPrestashopDestinationConnection`
 * / `createTestAllegroSourceConnection`.
 *
 * Integration tests run with `maxWorkers: 1` against ONE shared Testcontainers
 * Postgres for the whole CI run — a connection left `status: 'active'` after
 * its backing per-suite testcontainer is torn down in `afterAll` stays visible
 * to `OrderSyncService.resolveDestinations` (unscoped `OrderProcessorManager`
 * fan-out) for every suite that runs afterward in the same process, producing
 * an intermittent `fetch failed` against the dead container depending on Jest's
 * file-execution order. Suites that create an `OrderProcessorManager`-capable
 * connection MUST delete it here, not just stop the container.
 */
export async function deleteTestConnection(
  dataSource: DataSource,
  connectionId: string,
): Promise<void> {
  await dataSource.getRepository(ConnectionOrmEntity).delete({ id: connectionId });
}

/**
 * Seed an `integration_credentials` row directly. Encrypts the payload with
 * the same primitive the production repository uses (#709) so that downstream
 * decryption through `IntegrationCredentialRepository.getByRef` round-trips.
 */
async function seedIntegrationCredential(
  dataSource: DataSource,
  args: {
    ref: string;
    platformType: string;
    credentialsJson: Record<string, unknown>;
  },
): Promise<void> {
  const { key } = loadEncryptionKey(process.env);
  const repo = dataSource.getRepository(IntegrationCredentialOrmEntity);
  await repo.save(
    repo.create({
      ref: args.ref,
      platformType: args.platformType,
      credentialsCiphertext: encryptWithKey(key, JSON.stringify(args.credentialsJson)),
    }),
  );
}

/** A single carrier-mapping entry: Allegro delivery-method id → PS carrier id (as text). */
export interface CarrierMappingSeed {
  allegroDeliveryMethodId: string;
  prestashopCarrierId: string;
}

/**
 * Seed the FULL set of carrier mappings for a connection in one call, via the
 * public `MappingConfigService.upsertCarrierMappings` API — the same code path
 * the FE config screen uses, so contract drift surfaces here.
 *
 * IMPORTANT: `upsertCarrierMappings` is *replace-for-connection*, not additive —
 * it overwrites every mapping for the connection with the array passed. Seed all
 * of a connection's mappings in a SINGLE call; calling the singular
 * {@link seedCarrierMapping} more than once for the same connection keeps only
 * the last entry.
 *
 * `prestashopCarrierId` is passed as a string (the mapping table stores it as text);
 * the PS order-processor adapter parses it back to an int and writes it directly
 * as `id_carrier` on the cart. On a fresh PS install default carriers have
 * `id_carrier == id_reference`, so the int-spec passes whichever value the test
 * fixture exposes.
 */
export async function seedCarrierMappings(
  harness: IntegrationTestHarness,
  sourceConnectionId: string,
  mappings: CarrierMappingSeed[],
): Promise<void> {
  const mappingConfig = harness.getApp().get<IMappingConfigService>(MAPPING_CONFIG_SERVICE_TOKEN);
  await mappingConfig.upsertCarrierMappings(sourceConnectionId, mappings);
}

/**
 * Seed a single carrier mapping. Convenience wrapper over {@link seedCarrierMappings}.
 *
 * Use {@link seedCarrierMappings} when a connection needs more than one mapping —
 * the underlying API replaces the whole set per call, so successive singular calls
 * for the same connection would drop all but the last (see that function's note).
 */
export async function seedCarrierMapping(
  harness: IntegrationTestHarness,
  sourceConnectionId: string,
  allegroDeliveryMethodId: string,
  prestashopCarrierId: string,
): Promise<void> {
  await seedCarrierMappings(harness, sourceConnectionId, [
    { allegroDeliveryMethodId, prestashopCarrierId },
  ]);
}
