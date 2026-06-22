/**
 * Erli Offers Vertical-Slice Integration Test (#991)
 *
 * Exercises the Erli offers half end-to-end through the REAL
 * `ErliOfferManagerAdapter` wired to a fake `IErliHttpClient`, the production
 * adapter-resolution seam (`AdapterRegistryService` + `AdapterFactoryResolverService`
 * → `IntegrationsService.getCapabilityAdapter`), the live Redis-backed
 * `CachePort` (frozen-stock flag), and real Postgres persistence
 * (`offer_status_snapshots`). It proves the #984/#985/#986/#988/#1065/#1066/#989
 * pieces COMPOSE correctly — not the per-branch unit coverage those issues
 * already carry (plan §2 Out of Scope).
 *
 * Faking at the HTTP-transport seam (not the adapter seam) keeps the adapter's
 * create-body building, sparse PATCH, frozen-field suppression, variant-group
 * emission, and status mapping under test (plan §3 / A1). Assertions are limited
 * to recorded request paths/bodies and `offer_status_snapshots` rows — never
 * request headers or credential material (the bearer key is closed over inside
 * the real client and never reaches the fake; plan §6 assertion-scope rule).
 *
 * Field names are #992-provisional: this spec asserts the DOCUMENTED Erli wire
 * shape (erli-product.types.ts) and will be revisited if the #992 sandbox spike
 * contradicts it (plan §5 Documentation Gaps / R1).
 *
 * @module apps/api/test/integration/erli
 */
import { randomUUID } from 'crypto';
import type { DataSource } from 'typeorm';
import { encryptWithKey, loadEncryptionKey } from '@openlinker/shared';
import { ConnectionOrmEntity } from '@openlinker/core/identifier-mapping/orm-entities';
import { IntegrationCredentialOrmEntity } from '@openlinker/core/integrations/orm-entities';
import type {
  IIdentifierMappingService} from '@openlinker/core/identifier-mapping';
import {
  IDENTIFIER_MAPPING_SERVICE_TOKEN
} from '@openlinker/core/identifier-mapping';
import type {
  IIntegrationsService} from '@openlinker/core/integrations';
import {
  INTEGRATIONS_SERVICE_TOKEN
} from '@openlinker/core/integrations';
import {
  OFFER_STATUS_SNAPSHOT_REPOSITORY_TOKEN,
  OFFER_STATUS_SYNC_SERVICE_TOKEN,
  OfferCreateRejectedException,
  type CreateOfferCommand,
  type IOfferStatusSyncService,
  type OfferCreator,
  type OfferFieldUpdater,
  type OfferManagerPort,
  type OfferStatusReader,
  type OfferStatusSnapshotRepositoryPort,
  type UpdateOfferFieldsCommand,
  type UpdateOfferQuantityCommand,
} from '@openlinker/core/listings';
import { ErliConfigException } from '@openlinker/integrations-erli';

import type { IntegrationTestHarness} from '../setup';
import { getTestHarness, resetTestHarness, teardownTestHarness } from '../setup';
import {
  ERLI_TEST_ADAPTER_KEY,
  ERLI_TEST_PLATFORM_TYPE,
  installErliOffersHarness,
  type ErliOffersHarness,
} from '../helpers/erli-test-offer-manager.helper';

// Conforming OL variant ids (ERLI_PRODUCT_ID_PATTERN: /^ol_variant_[a-f0-9]{32}$/).
const VARIANT_A = 'ol_variant_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const VARIANT_B = 'ol_variant_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const VARIANT_C = 'ol_variant_cccccccccccccccccccccccccccccccc';
const PARENT_PRODUCT_ID = 'ol_product_dddddddddddddddddddddddddddddddd';
const ALLEGRO_CATEGORY_ID = '12345';

/** Path the adapter requests for a given offer id. */
function pathFor(id: string): string {
  return `products/${encodeURIComponent(id)}`;
}

function baseCreateCommand(
  connectionId: string,
  internalVariantId: string,
  overrides: Partial<CreateOfferCommand> = {},
): CreateOfferCommand {
  const { overrides: ov, ...rest } = overrides;
  return {
    internalVariantId,
    connectionId,
    price: { amount: 49.99, currency: 'PLN' },
    stock: 7,
    publishImmediately: true,
    variantBarcode: '5901234123457',
    ...rest,
    // Erli create fails closed without >=1 valid public-https image (#984); supply
    // one so every create case clears the image gate. `overrides` is DEEP-merged
    // so a per-test override EXTENDS these defaults (e.g. it keeps imageUrls) —
    // pass an explicit `categoryId: undefined` to exercise the no-Allegro-category path.
    overrides: {
      title: 'Test offer',
      categoryId: ALLEGRO_CATEGORY_ID,
      imageUrls: ['https://cdn.example.com/p.jpg'],
      ...ov,
    },
  };
}

describe('Erli Offers Vertical Slice Integration (#991)', () => {
  let harness: IntegrationTestHarness;
  let dataSource: DataSource;
  let erli: ErliOffersHarness;
  let connectionId: string;

  beforeAll(async () => {
    harness = await getTestHarness();
    dataSource = harness.getDataSource();
    erli = installErliOffersHarness(harness);
  });

  afterEach(async () => {
    erli.fake.reset();
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  /** Seed a fresh Erli connection (+ obviously-fake credential) before each case. */
  beforeEach(async () => {
    connectionId = await seedErliConnection(dataSource);
  });

  async function getAdapter(): Promise<
    OfferManagerPort & OfferCreator & OfferFieldUpdater & OfferStatusReader
  > {
    const integrations = harness
      .getApp()
      .get<IIntegrationsService>(INTEGRATIONS_SERVICE_TOKEN);
    return integrations.getCapabilityAdapter<
      OfferManagerPort & OfferCreator & OfferFieldUpdater & OfferStatusReader
    >(connectionId, 'OfferManager');
  }

  // ── S1: create → draft ────────────────────────────────────────────────────
  it('S1: creates an offer (POST 202 → draft) carrying name/price/stock/barcode/category', async () => {
    const adapter = await getAdapter();

    const result = await adapter.createOffer(baseCreateCommand(connectionId, VARIANT_A));

    expect(result.externalOfferId).toBe(VARIANT_A);
    expect(result.status).toBe('draft');

    const posts = erli.fake.callsOf('POST');
    expect(posts).toHaveLength(1);
    expect(posts[0].path).toBe(pathFor(VARIANT_A));
    const body = posts[0].body as Record<string, unknown>;
    expect(body.name).toBe('Test offer');
    // Price is serialised as an INTEGER in minor units (grosze) — 49.99 PLN → 4999.
    expect(body.price).toBe(4999);
    expect(body.stock).toBe(7);
    // Barcode rides the `ean` wire key (EAN/GTIN), not `barcode`.
    expect(body.ean).toBe('5901234123457');
    expect(body.externalCategories).toEqual([{ source: 'allegro', id: ALLEGRO_CATEGORY_ID }]);
    // No grouping for a single/simple product.
    expect(body.externalVariantGroup).toBeUndefined();
  });

  // ── S2: sparse field update (PATCH only the changed key) ───────────────────
  it('S2: updateOfferFields issues a sparse PATCH of only the changed field', async () => {
    const adapter = await getAdapter();
    // Live product with no frozen fields.
    erli.fake.setProduct(VARIANT_A, { frozenFields: [], status: 'active' });

    const cmd: UpdateOfferFieldsCommand = {
      externalOfferId: VARIANT_A,
      fields: { title: 'New title only' },
    };
    await adapter.updateOfferFields(cmd);

    const patches = erli.fake.callsOf('PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0].path).toBe(pathFor(VARIANT_A));
    const body = patches[0].body as Record<string, unknown>;
    expect(body).toEqual({ name: 'New title only' });
  });

  // ── S3: quantity propagation + frozen-stock no-op (cache, ordering matters) ─
  it('S3a: updateOfferQuantity PATCHes { stock } when stock is not frozen', async () => {
    const adapter = await getAdapter();

    const cmd: UpdateOfferQuantityCommand = { offerId: VARIANT_A, quantity: 42 };
    await adapter.updateOfferQuantity(cmd);

    const patches = erli.fake.callsOf('PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0].path).toBe(pathFor(VARIANT_A));
    expect(patches[0].body).toEqual({ stock: 42 });
  });

  it('S3b: updateOfferQuantity is a no-op once a status read cached frozen stock', async () => {
    const adapter = await getAdapter();
    // A status read that sees frozen stock populates the per-offer cache flag.
    erli.fake.setProduct(VARIANT_A, { frozenFields: ['stock'], status: 'active' });
    await adapter.getOfferStatus(VARIANT_A);

    const patchesBefore = erli.fake.callsOf('PATCH').length;
    await adapter.updateOfferQuantity({ offerId: VARIANT_A, quantity: 99 });

    // No stock PATCH was issued — the cached frozen flag suppressed it.
    expect(erli.fake.callsOf('PATCH').length).toBe(patchesBefore);
  });

  // ── S4: variant grouping body shape ────────────────────────────────────────
  it('S4: multi-variant create emits externalVariantGroup.id + attributes; single omits', async () => {
    const adapter = await getAdapter();

    // Multi-variant sibling: core-populated variantGroup hint present.
    await adapter.createOffer(
      baseCreateCommand(connectionId, VARIANT_B, {
        variantGroup: {
          groupId: PARENT_PRODUCT_ID,
          attributes: [{ name: 'Color', value: 'Red' }],
        },
      }),
    );
    const groupedBody = erli.fake.callsOf('POST')[0].body as Record<string, unknown>;
    expect(groupedBody.externalVariantGroup).toEqual({ id: PARENT_PRODUCT_ID });
    expect(groupedBody.attributes).toEqual([{ name: 'Color', value: 'Red' }]);

    erli.fake.reset();

    // Single-variant: no variantGroup → no grouping in the body.
    await adapter.createOffer(baseCreateCommand(connectionId, VARIANT_C));
    const singleBody = erli.fake.callsOf('POST')[0].body as Record<string, unknown>;
    expect(singleBody.externalVariantGroup).toBeUndefined();
    expect(singleBody.attributes).toBeUndefined();
  });

  // ── S5: frozen-field suppression + 0-stock listed as 0 ─────────────────────
  it('S5a: updateOfferFields drops a frozen field but keeps a non-frozen one', async () => {
    const adapter = await getAdapter();
    erli.fake.setProduct(VARIANT_A, { frozenFields: ['price'], status: 'active' });

    await adapter.updateOfferFields({
      externalOfferId: VARIANT_A,
      fields: { price: { amount: '59.99', currency: 'PLN' }, title: 'Renamed' },
    });

    const body = erli.fake.callsOf('PATCH')[0].body as Record<string, unknown>;
    expect(body.price).toBeUndefined();
    expect(body.name).toBe('Renamed');
  });

  it('S5b: a 0-stock create lists as 0 (not backfilled)', async () => {
    const adapter = await getAdapter();

    await adapter.createOffer(baseCreateCommand(connectionId, VARIANT_A, { stock: 0 }));

    const body = erli.fake.callsOf('POST')[0].body as Record<string, unknown>;
    expect(body.stock).toBe(0);
  });

  // ── S6: offer-status reconciliation into offer_status_snapshots ────────────
  it('S6: reconciliation transitions a snapshot activating → active across two syncs', async () => {
    const app = harness.getApp();
    const identifierMapping = app.get<IIdentifierMappingService>(IDENTIFIER_MAPPING_SERVICE_TOKEN);
    const syncService = app.get<IOfferStatusSyncService>(OFFER_STATUS_SYNC_SERVICE_TOKEN);
    const snapshots = app.get<OfferStatusSnapshotRepositoryPort>(
      OFFER_STATUS_SNAPSHOT_REPOSITORY_TOKEN,
      { strict: false },
    );

    const internalVariantId = 'ol_variant_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    // sync pages OfferMappingRepositoryPort.findMany → identifier_mappings
    // entityType='Offer'. externalId is the Erli product id (the GET-by-path key).
    await identifierMapping.createMapping('Offer', VARIANT_A, connectionId, internalVariantId);

    // Model Erli's async settle: accepted (→ activating) then active (→ active).
    erli.fake.enqueueGet(VARIANT_A, [
      { status: 'accepted', frozenFields: [] },
      { status: 'active', frozenFields: [] },
    ]);

    await syncService.sync(connectionId, { limit: 50, offset: 0 });
    const afterFirst = await snapshots.findByConnectionAndExternalOfferId(connectionId, VARIANT_A);
    expect(afterFirst?.publicationStatus).toBe('activating');
    expect(afterFirst?.internalVariantId).toBe(internalVariantId);

    await syncService.sync(connectionId, { limit: 50, offset: 0 });
    const afterSecond = await snapshots.findByConnectionAndExternalOfferId(connectionId, VARIANT_A);
    expect(afterSecond?.publicationStatus).toBe('active');
  });

  // ── S7: fail-closed on a malformed id (path-injection backstop) ────────────
  it('S7: a malformed variant id is rejected with ErliConfigException and sends nothing', async () => {
    const adapter = await getAdapter();
    const hostileId = 'ol_variant_../../etc/passwd';

    await expect(
      adapter.createOffer(baseCreateCommand(connectionId, hostileId)),
    ).rejects.toBeInstanceOf(ErliConfigException);

    await expect(
      adapter.updateOfferFields({ externalOfferId: hostileId, fields: { title: 'x' } }),
    ).rejects.toBeInstanceOf(ErliConfigException);

    expect(erli.fake.calls).toHaveLength(0);
  });

  // ── Sanity: missing Allegro taxonomy is a terminal create rejection ────────
  it('rejects create with OfferCreateRejectedException when no Allegro category is resolved', async () => {
    const adapter = await getAdapter();

    await expect(
      adapter.createOffer(
        // Clear the helper's default categoryId so no Allegro taxonomy resolves
        // (deep-merge keeps imageUrls, so the failure is the missing category, not images).
        baseCreateCommand(connectionId, VARIANT_A, {
          overrides: { title: 'No category', categoryId: undefined },
        }),
      ),
    ).rejects.toBeInstanceOf(OfferCreateRejectedException);
  });
});

/**
 * Seed an active Erli connection wired to the test adapterKey + OfferManager
 * capability, plus an obviously-fake credential row (the real adapter never
 * consumes it; present for referential hygiene + acceptance criterion).
 */
async function seedErliConnection(dataSource: DataSource): Promise<string> {
  const credentialsRef = `test-erli-${randomUUID()}`;
  const { key } = loadEncryptionKey(process.env);
  const credRepo = dataSource.getRepository(IntegrationCredentialOrmEntity);
  await credRepo.save(
    credRepo.create({
      ref: credentialsRef,
      platformType: ERLI_TEST_PLATFORM_TYPE,
      // Obviously-fake key; never a real secret.
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
