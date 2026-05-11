/**
 * Content Draft — Integration Tests
 *
 * Exercises ContentDraftService against a real Postgres via the shared
 * Testcontainers harness. Verifies:
 *  - Storage round-trip (insert / update via the upsert path).
 *  - Reconcile semantics (silent vs conflict-marking branches).
 *  - The two partial unique indexes — master and channel rows for the same
 *    (productId, fieldKey) coexist without collision.
 *  - Read-side resolution with channel→master fallback.
 *
 * Publish path is covered in unit tests only — real publishing requires the
 * PrestaShop integration container, which is out of scope for this harness.
 *
 * @module apps/api/test/integration
 */
import { DataSource } from 'typeorm';
import {
  CONTENT_DRAFT_SERVICE_TOKEN,
  ContentConflictException,
  type IContentDraftService,
  type ProductContentField,
} from '@openlinker/core/content';
import { ProductOrmEntity } from '@openlinker/core/products';
import { ProductContentFieldOrmEntity } from '@openlinker/core/content';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';

const seedProduct = async (ds: DataSource, suffix: string): Promise<string> => {
  const productId = `ol_product_int_${suffix}`;
  const repo = ds.getRepository(ProductOrmEntity);
  await repo.save(
    repo.create({
      id: productId,
      name: `Integration test product ${suffix}`,
      sku: null,
      price: null,
    }),
  );
  return productId;
};

const findRow = async (
  ds: DataSource,
  productId: string,
  connectionId: string | null,
): Promise<ProductContentFieldOrmEntity | null> => {
  const where: Record<string, unknown> = { productId, fieldKey: 'description' };
  // typeorm find treats undefined as missing condition; use a raw query to handle null vs uuid uniformly.
  const rows = (await ds.query(
    `SELECT * FROM product_content_field WHERE product_id = $1 AND field_key = $2 AND ${
      connectionId === null ? 'connection_id IS NULL' : 'connection_id = $3'
    }`,
    connectionId === null ? [productId, where.fieldKey] : [productId, where.fieldKey, connectionId],
  )) as Array<Record<string, unknown>>;
  if (rows.length === 0) return null;
  const r = rows[0];
  const orm = new ProductContentFieldOrmEntity();
  orm.id = r.id as string;
  orm.productId = r.product_id as string;
  orm.connectionId = r.connection_id as string | null;
  orm.fieldKey = r.field_key as string;
  orm.draftValue = r.draft_value as string | null;
  orm.baseValue = r.base_value as string | null;
  orm.baseVersion = r.base_version as string | null;
  orm.hasConflict = r.has_conflict as boolean;
  orm.createdAt = new Date(r.created_at as string);
  orm.updatedAt = new Date(r.updated_at as string);
  orm.updatedBy = r.updated_by as string | null;
  return orm;
};

describe('Content Draft Integration', () => {
  let dataSource: DataSource;
  let service: IContentDraftService;

  beforeAll(async () => {
    const harness = await getTestHarness();
    dataSource = harness.getDataSource();
    service = harness.getApp().get<IContentDraftService>(CONTENT_DRAFT_SERVICE_TOKEN);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('persists a fresh master draft on saveDraft', async () => {
    const productId = await seedProduct(dataSource, 'save-1');

    const saved: ProductContentField = await service.saveDraft({
      productId,
      connectionId: null,
      fieldKey: 'description',
      value: 'fresh draft',
      userId: 'user-1',
    });

    expect(saved.draftValue).toBe('fresh draft');
    expect(saved.baseValue).toBeNull();
    expect(saved.hasConflict).toBe(false);

    const row = await findRow(dataSource, productId, null);
    expect(row?.draftValue).toBe('fresh draft');
    expect(row?.updatedBy).toBe('user-1');
  });

  it('silently refreshes base on reconcileExternal when no draft exists', async () => {
    const productId = await seedProduct(dataSource, 'rec-silent');

    await service.reconcileExternal({
      productId,
      connectionId: null,
      fieldKey: 'description',
      externalValue: 'platform value',
      externalVersion: 'v1',
    });

    const row = await findRow(dataSource, productId, null);
    expect(row?.baseValue).toBe('platform value');
    expect(row?.baseVersion).toBe('v1');
    expect(row?.draftValue).toBeNull();
    expect(row?.hasConflict).toBe(false);
  });

  it('marks hasConflict=true when reconcile sees a divergent external version while a draft is pending', async () => {
    const productId = await seedProduct(dataSource, 'rec-conflict');

    // Establish a base via reconcile, then save a draft, then reconcile with a new external version.
    await service.reconcileExternal({
      productId,
      connectionId: null,
      fieldKey: 'description',
      externalValue: 'original',
      externalVersion: 'v1',
    });
    await service.saveDraft({
      productId,
      connectionId: null,
      fieldKey: 'description',
      value: 'pending edit',
      userId: 'user-1',
    });
    await service.reconcileExternal({
      productId,
      connectionId: null,
      fieldKey: 'description',
      externalValue: 'someone else changed it',
      externalVersion: 'v2',
    });

    const row = await findRow(dataSource, productId, null);
    expect(row?.draftValue).toBe('pending edit');
    expect(row?.baseValue).toBe('someone else changed it');
    expect(row?.baseVersion).toBe('v2');
    expect(row?.hasConflict).toBe(true);
  });

  it('clears hasConflict when the user re-saves the draft (implicit acknowledgement)', async () => {
    const productId = await seedProduct(dataSource, 'rec-ack');

    await service.reconcileExternal({
      productId,
      connectionId: null,
      fieldKey: 'description',
      externalValue: 'orig',
      externalVersion: 'v1',
    });
    await service.saveDraft({
      productId,
      connectionId: null,
      fieldKey: 'description',
      value: 'first draft',
      userId: 'user-1',
    });
    await service.reconcileExternal({
      productId,
      connectionId: null,
      fieldKey: 'description',
      externalValue: 'remote',
      externalVersion: 'v2',
    });

    const conflicted = await findRow(dataSource, productId, null);
    expect(conflicted?.hasConflict).toBe(true);

    await service.saveDraft({
      productId,
      connectionId: null,
      fieldKey: 'description',
      value: 'reconciled draft',
      userId: 'user-1',
    });

    const after = await findRow(dataSource, productId, null);
    expect(after?.hasConflict).toBe(false);
    expect(after?.draftValue).toBe('reconciled draft');
  });

  it('throws ContentConflictException when publishDraft is called on a conflicted row', async () => {
    const productId = await seedProduct(dataSource, 'pub-conflict');

    await service.reconcileExternal({
      productId,
      connectionId: null,
      fieldKey: 'description',
      externalValue: 'orig',
      externalVersion: 'v1',
    });
    await service.saveDraft({
      productId,
      connectionId: null,
      fieldKey: 'description',
      value: 'pending',
      userId: 'user-1',
    });
    await service.reconcileExternal({
      productId,
      connectionId: null,
      fieldKey: 'description',
      externalValue: 'remote update',
      externalVersion: 'v2',
    });

    await expect(
      service.publishDraft({
        productId,
        connectionId: null,
        fieldKey: 'description',
      }),
    ).rejects.toBeInstanceOf(ContentConflictException);
  });

  it('discards a draft and leaves the base intact', async () => {
    const productId = await seedProduct(dataSource, 'discard');

    await service.reconcileExternal({
      productId,
      connectionId: null,
      fieldKey: 'description',
      externalValue: 'base',
      externalVersion: 'v1',
    });
    await service.saveDraft({
      productId,
      connectionId: null,
      fieldKey: 'description',
      value: 'oops',
      userId: 'user-1',
    });
    await service.discardDraft({
      productId,
      connectionId: null,
      fieldKey: 'description',
    });

    const row = await findRow(dataSource, productId, null);
    expect(row?.draftValue).toBeNull();
    expect(row?.baseValue).toBe('base');
    expect(row?.baseVersion).toBe('v1');
  });

  it('lets a master row and a channel-scoped row coexist for the same (productId, fieldKey) under the partial unique indexes', async () => {
    const productId = await seedProduct(dataSource, 'partial-unique');
    const conn = await createTestConnection(dataSource, { name: 'channel-conn' });

    await service.saveDraft({
      productId,
      connectionId: null,
      fieldKey: 'description',
      value: 'master draft',
      userId: 'user-1',
    });
    await service.saveDraft({
      productId,
      connectionId: conn.id,
      fieldKey: 'description',
      value: 'channel draft',
      userId: 'user-1',
    });

    const master = await findRow(dataSource, productId, null);
    const channel = await findRow(dataSource, productId, conn.id);
    expect(master?.draftValue).toBe('master draft');
    expect(channel?.draftValue).toBe('channel draft');
    expect(master?.id).not.toBe(channel?.id);
  });

  it('resolves channel value when present, falling back to master otherwise', async () => {
    const productId = await seedProduct(dataSource, 'resolve');
    const conn = await createTestConnection(dataSource, { name: 'resolve-conn' });

    await service.reconcileExternal({
      productId,
      connectionId: null,
      fieldKey: 'description',
      externalValue: 'master base',
      externalVersion: 'v1',
    });

    // No channel row yet → resolve(channel) falls back to master.
    const beforeChannelOverride = await service.resolveValue({
      productId,
      connectionId: conn.id,
      fieldKey: 'description',
    });
    expect(beforeChannelOverride).toBe('master base');

    // Channel override saved → resolve(channel) returns channel draft.
    await service.saveDraft({
      productId,
      connectionId: conn.id,
      fieldKey: 'description',
      value: 'channel override',
      userId: 'user-1',
    });

    const afterChannelOverride = await service.resolveValue({
      productId,
      connectionId: conn.id,
      fieldKey: 'description',
    });
    expect(afterChannelOverride).toBe('channel override');

    // Master resolution still sees master base.
    const masterResolved = await service.resolveValue({
      productId,
      connectionId: null,
      fieldKey: 'description',
    });
    expect(masterResolved).toBe('master base');
  });
});
