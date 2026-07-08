/**
 * Erli Category-Catalog Integration Test (#1383, ADR-031)
 *
 * Exercises the REAL `ErliAdapterFactory.createAdapters` credential check, the
 * REAL `ErliOfferManagerAdapter` per-instance `fetchCategories`/
 * `fetchCategoryParameters` wiring, and the REAL `AllegroCategoryCatalogClient`
 * HTTP flow (`global.fetch` stubbed — no real Allegro network calls) — through
 * the production adapter-resolution seam (`IntegrationsService.getCapabilityAdapter`)
 * and the real HTTP surface
 * (`GET /listings/connections/:connectionId/categories/:categoryId/parameters`).
 *
 * Two connections, same adapterKey, differing only in resolved credentials:
 *  - WITH valid `allegroClientId`/`allegroClientSecret` → the endpoint returns
 *    real category-parameter data, and `isCategoryBrowser`/
 *    `isCategoryParametersReader` are `true` on the resolved adapter instance.
 *  - WITHOUT (or with only one of the pair) → the endpoint 422s exactly like
 *    today's "adapter doesn't implement this capability" case — NOT a new
 *    error path (#1383 assumption verified against `CategoriesCacheService` /
 *    `ListingsController` unchanged). Guard functions are `false`.
 *
 * `connection.supportedCapabilities` (the connection-response DTO field) is
 * asserted to stay IDENTICAL across both connections. It is populated from the
 * static, per-adapterKey `AdapterMetadata.supportedCapabilities` — never
 * connection-instance-aware — and ADR-031 deliberately does NOT add
 * `CategoryBrowser`/`CategoryParametersReader` there: doing so would advertise
 * the capability for every Erli connection regardless of configuration,
 * exactly the regression ADR-031 rules out (and the #1367 bulk-wizard gate
 * reads `supportedCapabilities`, not the runtime adapter). The real,
 * per-connection-accurate signal is the guard functions on the resolved
 * adapter instance and this HTTP endpoint's behaviour, which this spec
 * exercises directly.
 *
 * @module apps/api/test/integration/listings
 */
import { randomUUID } from 'crypto';
import type { DataSource } from 'typeorm';
import request from 'supertest';
import { encryptWithKey, loadEncryptionKey } from '@openlinker/shared';
import { ConnectionOrmEntity } from '@openlinker/core/identifier-mapping/orm-entities';
import { IntegrationCredentialOrmEntity } from '@openlinker/core/integrations/orm-entities';
import type {
  AdapterFactoryResolverService,
  AdapterRegistryPort,
  CredentialsResolverPort,
  IIntegrationsService,
} from '@openlinker/core/integrations';
import {
  ADAPTER_FACTORY_RESOLVER_TOKEN,
  ADAPTER_REGISTRY_TOKEN,
  INTEGRATIONS_SERVICE_TOKEN,
} from '@openlinker/core/integrations';
import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { isCategoryBrowser, isCategoryParametersReader, type OfferManagerPort } from '@openlinker/core/listings';
import { ErliAdapterFactory } from '@openlinker/integrations-erli/application/erli-adapter.factory';

import type { IntegrationTestHarness } from '../setup';
import { getTestHarness, resetTestHarness, teardownTestHarness } from '../setup';
import { loginAsAdmin } from '../helpers/test-auth.helper';

const TEST_ADAPTER_KEY = 'erli.catalog.test.v1';
const TEST_PLATFORM_TYPE = 'erli';
const CATEGORY_ID = '258066';

/** Registers the test adapterKey once, backed by the REAL `ErliAdapterFactory`. */
function installErliCatalogTestFactory(harness: IntegrationTestHarness): void {
  const app = harness.getApp();
  const adapterRegistry = app.get<AdapterRegistryPort>(ADAPTER_REGISTRY_TOKEN);
  const factoryResolver = app.get<AdapterFactoryResolverService>(ADAPTER_FACTORY_RESOLVER_TOKEN);

  adapterRegistry.register({
    adapterKey: TEST_ADAPTER_KEY,
    platformType: TEST_PLATFORM_TYPE,
    // Mirrors the real `erliAdapterManifest` — deliberately does NOT list
    // 'CategoryBrowser'/'CategoryParametersReader' (ADR-031: per-instance,
    // never a static per-adapterKey capability).
    supportedCapabilities: ['OfferManager'],
    displayName: 'Erli OfferManager (integration-test, real factory)',
    version: '0.0.0-test',
    isDefault: false,
  });

  factoryResolver.registerFactory(TEST_ADAPTER_KEY, {
    createCapabilityAdapter: async <T>(
      connection: Connection,
      _capability: string,
      identifierMapping: IdentifierMappingPort,
      credentialsResolver: CredentialsResolverPort,
    ): Promise<T> => {
      // REAL factory — exercises the #1383 credential-check + AllegroCategoryCatalogClient
      // wiring under test, not a hand-rolled substitute.
      const adapters = await new ErliAdapterFactory().createAdapters(
        connection,
        identifierMapping,
        credentialsResolver,
      );
      return adapters.offerManager as unknown as T;
    },
  });
}

async function seedErliConnection(
  dataSource: DataSource,
  credentials: Record<string, unknown>,
): Promise<string> {
  const credentialsRef = `test-erli-catalog-${randomUUID()}`;
  const { key } = loadEncryptionKey(process.env);
  const credRepo = dataSource.getRepository(IntegrationCredentialOrmEntity);
  await credRepo.save(
    credRepo.create({
      ref: credentialsRef,
      platformType: TEST_PLATFORM_TYPE,
      credentialsCiphertext: encryptWithKey(key, JSON.stringify(credentials)),
    }),
  );

  const connRepo = dataSource.getRepository(ConnectionOrmEntity);
  const connection = await connRepo.save(
    connRepo.create({
      platformType: TEST_PLATFORM_TYPE,
      name: 'Test Erli connection (category catalog)',
      status: 'active',
      config: {},
      credentialsRef: `db:${credentialsRef}`,
      adapterKey: TEST_ADAPTER_KEY,
      enabledCapabilities: ['OfferManager'],
    }),
  );
  return connection.id;
}

/** Fixture Allegro category-parameters response, mirroring the real wire shape. */
function allegroCategoryParametersFixture(): { parameters: unknown[] } {
  return {
    parameters: [
      {
        id: 'param-1',
        name: 'Colour',
        type: 'string',
        required: false,
        restrictions: {},
      },
    ],
  };
}

describe('Erli Category-Catalog Integration (#1383, ADR-031)', () => {
  let harness: IntegrationTestHarness;
  let dataSource: DataSource;
  let originalFetch: typeof fetch;

  beforeAll(async () => {
    harness = await getTestHarness();
    dataSource = harness.getDataSource();
    installErliCatalogTestFactory(harness);
    originalFetch = global.fetch;
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  function stubAllegroFetch(): jest.Mock {
    const fetchMock = jest.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/oauth/token')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: (): Promise<Record<string, unknown>> =>
            Promise.resolve({ access_token: 'fake-allegro-token', expires_in: 3600, token_type: 'bearer' }),
        } as unknown as Response);
      }
      if (url.includes(`/sale/categories/${CATEGORY_ID}/parameters`)) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: (): Promise<{ parameters: unknown[] }> =>
            Promise.resolve(allegroCategoryParametersFixture()),
        } as unknown as Response);
      }
      return Promise.reject(new Error(`Unexpected fetch call in test: ${url}`));
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  async function getOfferManagerAdapter(connectionId: string): Promise<OfferManagerPort> {
    const integrations = harness.getApp().get<IIntegrationsService>(INTEGRATIONS_SERVICE_TOKEN);
    return integrations.getCapabilityAdapter<OfferManagerPort>(connectionId, 'OfferManager');
  }

  async function getSupportedCapabilities(
    http: ReturnType<typeof request>,
    token: string,
    connectionId: string,
  ): Promise<string[]> {
    const response = await http
      .get(`/v1/connections/${connectionId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return response.body.supportedCapabilities as string[];
  }

  describe('a connection WITH valid Allegro app credentials', () => {
    it('exposes CategoryBrowser/CategoryParametersReader on the resolved adapter and returns real parameter data over HTTP', async () => {
      stubAllegroFetch();
      const connectionId = await seedErliConnection(dataSource, {
        apiKey: 'erli-key-not-real',
        allegroClientId: 'client-1',
        allegroClientSecret: 'secret-1',
      });

      const adapter = await getOfferManagerAdapter(connectionId);
      expect(isCategoryBrowser(adapter)).toBe(true);
      expect(isCategoryParametersReader(adapter)).toBe(true);

      const http = request(harness.getApp().getHttpServer());
      const token = await loginAsAdmin(http, dataSource);

      const response = await http
        .get(`/v1/listings/connections/${connectionId}/categories/${CATEGORY_ID}/parameters`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.parameters).toEqual([
        expect.objectContaining({ id: 'param-1', name: 'Colour' }),
      ]);

      // No static leak: supportedCapabilities is the static per-adapterKey set,
      // never widened by per-connection Allegro credential configuration.
      const supported = await getSupportedCapabilities(http, token, connectionId);
      expect(supported).toEqual(['OfferManager']);
    });
  });

  describe('a connection WITHOUT Allegro app credentials', () => {
    it('does NOT expose CategoryBrowser/CategoryParametersReader and the HTTP endpoint 422s like an unsupported capability', async () => {
      const connectionId = await seedErliConnection(dataSource, {
        apiKey: 'erli-key-not-real',
      });

      const adapter = await getOfferManagerAdapter(connectionId);
      expect(isCategoryBrowser(adapter)).toBe(false);
      expect(isCategoryParametersReader(adapter)).toBe(false);

      const http = request(harness.getApp().getHttpServer());
      const token = await loginAsAdmin(http, dataSource);

      const response = await http
        .get(`/v1/listings/connections/${connectionId}/categories/${CATEGORY_ID}/parameters`)
        .set('Authorization', `Bearer ${token}`)
        .expect(422);
      expect(response.body.message).toContain('does not support category-parameters reading');

      const supported = await getSupportedCapabilities(http, token, connectionId);
      expect(supported).toEqual(['OfferManager']);
    });
  });

  describe('a connection with only ONE of the Allegro credential pair', () => {
    it('does NOT expose CategoryBrowser/CategoryParametersReader (both-or-neither, ADR-031)', async () => {
      const connectionId = await seedErliConnection(dataSource, {
        apiKey: 'erli-key-not-real',
        allegroClientId: 'client-1',
        // allegroClientSecret intentionally absent — a pre-existing/externally
        // written row could carry this shape even though the shape validator
        // rejects it at write time; the factory must still fail closed.
      });

      const adapter = await getOfferManagerAdapter(connectionId);
      expect(isCategoryBrowser(adapter)).toBe(false);
      expect(isCategoryParametersReader(adapter)).toBe(false);
    });
  });
});
