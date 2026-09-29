/**
 * Order column presets — personal vs workspace default integration test (#3530, D32)
 *
 * The whole point of `OrderColumnPresetOrmEntity`'s partial unique index
 * (`UQ_order_column_presets_workspace_default`, `WHERE "userId" IS NULL`) is
 * a guarantee a mocked repository cannot prove: that AT MOST ONE workspace
 * default row can ever exist, and that it is never returned by
 * `findByUserId` for any real user. Only a real Postgres index enforces
 * that.
 *
 * @module apps/api/test/integration
 */
import type { IntegrationTestHarness } from './setup';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { OrderColumnPresetRepositoryPort } from '@openlinker/core/orders';
import { ORDER_COLUMN_PRESET_REPOSITORY_TOKEN } from '@openlinker/core/orders';

const USER_A = '55555555-5555-4555-8555-555555555555';
const USER_B = '66666666-6666-4666-8666-666666666666';

describe('order column presets — personal vs workspace default (integration, #3530, D32)', () => {
  let harness: IntegrationTestHarness;
  let repository: OrderColumnPresetRepositoryPort;

  beforeAll(async () => {
    harness = await getTestHarness();
    repository = harness
      .getApp()
      .get<OrderColumnPresetRepositoryPort>(ORDER_COLUMN_PRESET_REPOSITORY_TOKEN);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('a user reads only their own presets, never another user\'s or the workspace default', async () => {
    await repository.create({ userId: USER_A, name: 'Mine', columns: ['orderNumber'] });
    await repository.create({ userId: USER_B, name: 'Theirs', columns: ['customerEmail'] });
    await repository.upsertWorkspaceDefault(['placedAt']);

    const mine = await repository.findByUserId(USER_A);
    expect(mine).toHaveLength(1);
    expect(mine[0].name).toBe('Mine');
  });

  it('upsertWorkspaceDefault replaces the single workspace-default row rather than inserting a second one', async () => {
    await repository.upsertWorkspaceDefault(['orderNumber', 'currency']);
    const first = await repository.findWorkspaceDefault();
    expect(first?.columns).toEqual(['orderNumber', 'currency']);

    await repository.upsertWorkspaceDefault(['placedAt']);
    const second = await repository.findWorkspaceDefault();
    expect(second?.columns).toEqual(['placedAt']);
    expect(second?.id).toBe(first?.id);

    const raw: { count: string }[] = await harness
      .getDataSource()
      .query(`SELECT count(*) FROM "order_column_presets" WHERE "userId" IS NULL`);
    expect(raw[0].count).toBe('1');
  });

  it('a user with no saved preset gets no workspace-default row inside their own list', async () => {
    await repository.upsertWorkspaceDefault(['orderNumber']);
    const mine = await repository.findByUserId(USER_A);
    expect(mine).toHaveLength(0);
  });

  it('deleting one user\'s preset never touches the workspace default', async () => {
    const mine = await repository.create({ userId: USER_A, name: 'Mine', columns: ['orderNumber'] });
    await repository.upsertWorkspaceDefault(['placedAt']);

    await repository.delete(mine.id);

    expect(await repository.findWorkspaceDefault()).not.toBeNull();
  });
});
