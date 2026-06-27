/**
 * ERLI Provenance Reuse Integration Test (#1045, ADR-023 §40/§83)
 *
 * Proves the issue's acceptance end-to-end against real Postgres-persisted
 * mappings, the real `MappingConfigService` + `CategoryResolutionService` +
 * `AttributeProjectionService`, and the REAL `ErliOfferManagerAdapter` (wired to
 * a fake `IErliHttpClient` via the offers harness):
 *
 *  - An operator authors PrestaShop→Allegro category + attribute mappings against
 *    their **Allegro** connection only (provenance `'allegro'`). ZERO rows are
 *    authored for the Erli connection.
 *  - Resolving for the **Erli** destination — which declares `TaxonomyBorrower`
 *    (`getBorrowedTaxonomy() === 'allegro'`) — reuses those Allegro-authored rows
 *    by provenance with zero re-authoring, and the resulting `createOffer` body
 *    carries `source:"allegro"` category + parameter ids verbatim.
 *
 * Assertions cover the recorded request body only (never headers/credentials),
 * mirroring the offers vertical-slice scope rule.
 *
 * @module apps/api/test/integration/erli
 */
import { randomUUID } from 'crypto';
import type { DataSource } from 'typeorm';
import { encryptWithKey, loadEncryptionKey } from '@openlinker/shared';
import { ConnectionOrmEntity } from '@openlinker/core/identifier-mapping/orm-entities';
import { IntegrationCredentialOrmEntity } from '@openlinker/core/integrations/orm-entities';
import {
  ATTRIBUTE_PROJECTION_SERVICE_TOKEN,
  CATEGORY_RESOLUTION_SERVICE_TOKEN,
  type CreateOfferCommand,
  type IAttributeProjectionService,
  type ICategoryResolutionService,
  type OfferCreator,
  type OfferManagerPort,
} from '@openlinker/core/listings';
import {
  MAPPING_CONFIG_SERVICE_TOKEN,
  type IMappingConfigService,
} from '@openlinker/core/mappings';
import { INTEGRATIONS_SERVICE_TOKEN, type IIntegrationsService } from '@openlinker/core/integrations';

import type { IntegrationTestHarness } from '../setup';
import { getTestHarness, resetTestHarness, teardownTestHarness } from '../setup';
import {
  ERLI_TEST_ADAPTER_KEY,
  ERLI_TEST_PLATFORM_TYPE,
  installErliOffersHarness,
  type ErliOffersHarness,
} from '../helpers/erli-test-offer-manager.helper';

const VARIANT_A = 'ol_variant_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SOURCE_CATEGORY_ID = 'ps-cat-1';
const ALLEGRO_CATEGORY_ID = '258066';

describe('ERLI Provenance Reuse Integration (#1045)', () => {
  let harness: IntegrationTestHarness;
  let dataSource: DataSource;
  let erli: ErliOffersHarness;
  let erliConnectionId: string;
  // The source (PrestaShop master) and owner (Allegro) connection ids the
  // operator authored their mappings under — distinct from the Erli connection.
  let sourceConnectionId: string;
  let allegroConnectionId: string;

  let mappingConfig: IMappingConfigService;
  let categoryResolution: ICategoryResolutionService;
  let attributeProjection: IAttributeProjectionService;

  beforeAll(async () => {
    harness = await getTestHarness();
    dataSource = harness.getDataSource();
    erli = installErliOffersHarness(harness);
    const app = harness.getApp();
    mappingConfig = app.get<IMappingConfigService>(MAPPING_CONFIG_SERVICE_TOKEN, { strict: false });
    categoryResolution = app.get<ICategoryResolutionService>(CATEGORY_RESOLUTION_SERVICE_TOKEN, {
      strict: false,
    });
    attributeProjection = app.get<IAttributeProjectionService>(ATTRIBUTE_PROJECTION_SERVICE_TOKEN, {
      strict: false,
    });
  });

  afterEach(async () => {
    erli.fake.reset();
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  beforeEach(async () => {
    erliConnectionId = await seedErliConnection(dataSource);
    sourceConnectionId = randomUUID();
    allegroConnectionId = randomUUID();

    // Author Allegro-destination mappings ONLY (provenance 'allegro'), scoped to
    // the PrestaShop source store. No rows are authored for the Erli connection.
    await mappingConfig.upsertCategoryMapping(allegroConnectionId, {
      sourceCategoryId: SOURCE_CATEGORY_ID,
      destinationCategoryId: ALLEGRO_CATEGORY_ID,
      destinationCategoryName: 'Smartphones',
      sourceConnectionId,
      destinationTaxonomyProvenance: 'allegro',
    });
    await mappingConfig.upsertAttributeMapping(allegroConnectionId, {
      sourceConnectionId,
      sourceAttributeKey: 'Color',
      destinationParameterName: 'colour',
      destinationTaxonomyProvenance: 'allegro',
      values: [{ sourceValue: 'Red', destinationValue: 'red' }],
    });
  });

  async function getAdapter(): Promise<OfferManagerPort & OfferCreator> {
    const integrations = harness.getApp().get<IIntegrationsService>(INTEGRATIONS_SERVICE_TOKEN);
    return integrations.getCapabilityAdapter<OfferManagerPort & OfferCreator>(
      erliConnectionId,
      'OfferManager',
    );
  }

  it('reuses Allegro-authored category + attribute mappings for an ERLI offer with zero ERLI rows', async () => {
    // Precondition: the operator authored NO mappings against the Erli connection.
    expect(await mappingConfig.getCategoryMappings(erliConnectionId)).toEqual([]);
    expect(await mappingConfig.getAttributeMappings(erliConnectionId)).toEqual([]);

    // 1. Category resolution reuses the Allegro row by provenance.
    const category = await categoryResolution.resolveCategory({
      connectionId: erliConnectionId,
      sourceCategoryIds: [SOURCE_CATEGORY_ID],
      borrowedTaxonomy: 'allegro',
      sourceConnectionId,
    });
    expect(category.destinationCategoryId).toBe(ALLEGRO_CATEGORY_ID);
    expect(category.provenance).toBe('borrows');
    expect(category.method).toBe('category_mapping');

    // 2. Attribute projection reuses the Allegro attribute mapping by provenance.
    const projection = await attributeProjection.project({
      sourceConnectionId,
      destinationConnectionId: erliConnectionId,
      destinationCategoryId: ALLEGRO_CATEGORY_ID,
      attributes: { Color: 'Red' },
      borrowedTaxonomy: 'allegro',
    });
    expect(projection.parameters).toEqual([{ id: 'colour', values: ['red'], section: 'offer' }]);

    // 3. The real Erli adapter emits source:"allegro" category + parameter ids verbatim.
    const adapter = await getAdapter();
    const command: CreateOfferCommand = {
      internalVariantId: VARIANT_A,
      connectionId: erliConnectionId,
      price: { amount: 49.99, currency: 'PLN' },
      stock: 7,
      publishImmediately: true,
      variantBarcode: '5901234123457',
      parameters: projection.parameters,
      overrides: {
        title: 'Reused-taxonomy offer',
        categoryId: category.destinationCategoryId ?? undefined,
        imageUrls: ['https://cdn.example.com/p.jpg'],
      },
    };
    const result = await adapter.createOffer(command);
    expect(result.status).toBe('draft');

    const body = erli.fake.callsOf('POST')[0].body as Record<string, unknown>;
    expect(body.externalCategories).toEqual([
      { source: 'allegro', breadcrumb: [{ id: ALLEGRO_CATEGORY_ID }] },
    ]);
    expect(body.externalAttributes).toEqual([
      { source: 'allegro', id: 'colour', type: 'string', values: ['red'] },
    ]);
  });
});

/**
 * Seed an active Erli connection wired to the test adapterKey + OfferManager
 * capability (mirrors the offers vertical-slice helper).
 */
async function seedErliConnection(dataSource: DataSource): Promise<string> {
  const credentialsRef = `test-erli-${randomUUID()}`;
  const { key } = loadEncryptionKey(process.env);
  const credRepo = dataSource.getRepository(IntegrationCredentialOrmEntity);
  await credRepo.save(
    credRepo.create({
      ref: credentialsRef,
      platformType: ERLI_TEST_PLATFORM_TYPE,
      credentialsCiphertext: encryptWithKey(key, JSON.stringify({ apiKey: 'test-erli-key-not-real' })),
    }),
  );

  const connRepo = dataSource.getRepository(ConnectionOrmEntity);
  const connection = await connRepo.save(
    connRepo.create({
      platformType: ERLI_TEST_PLATFORM_TYPE,
      name: 'Test Erli connection',
      status: 'active',
      config: {},
      credentialsRef: `db:${credentialsRef}`,
      adapterKey: ERLI_TEST_ADAPTER_KEY,
      enabledCapabilities: ['OfferManager'],
    }),
  );
  return connection.id;
}
