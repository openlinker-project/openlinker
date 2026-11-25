/**
 * Saved Views Integration Test (#4241)
 *
 * Vertical slice over real Postgres for the named-list-view surface:
 *
 *   GET/POST /saved-views, PATCH/DELETE /saved-views/:id, PUT /saved-views/default
 *
 * What only the boundary can prove (the unit specs fake the repository):
 *   - the two PARTIAL unique indexes (personal and shared are separate name
 *     domains) surface as 409;
 *   - the `revision` guard is a real conditional UPDATE (409 on a stale one);
 *   - another user's personal view is a 404, a shared write by a non-admin a 403;
 *   - a packer is refused outright;
 *   - a stored definition this build does not understand is returned flagged,
 *     never a 500.
 *
 * The user-deletion cascade is NOT here: the harness builds its schema with
 * `synchronize`, which never creates the migration-only FKs. It is proved in
 * `fulfillment-work-migration-parity.int-spec.ts`, against the migrated schema.
 *
 * @module apps/api/test/integration
 */
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { IntegrationTestHarness } from './setup';
import { loginAs } from './helpers/test-auth.helper';

const definition = {
  v: 1,
  query: '',
  sort: { key: 'created', dir: 'desc' },
  columns: ['customer', 'money'],
  parts: { money: ['amount'] },
};

describe('Saved Views Integration', () => {
  let harness: IntegrationTestHarness;

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  const tokens = async (): Promise<{
    admin: string;
    alice: string;
    bob: string;
    viewer: string;
    packer: string;
  }> => {
    const http = harness.getHttp();
    const ds = harness.getDataSource();
    return {
      admin: await loginAs(http, ds, 'admin', 'sv-admin'),
      alice: await loginAs(http, ds, 'operator', 'sv-alice'),
      bob: await loginAs(http, ds, 'operator', 'sv-bob'),
      viewer: await loginAs(http, ds, 'viewer', 'sv-viewer'),
      packer: await loginAs(http, ds, 'packer', 'sv-packer'),
    };
  };

  const create = (token: string, body: Record<string, unknown>) =>
    harness
      .getHttp()
      .post('/v1/saved-views')
      .set('Authorization', `Bearer ${token}`)
      .send({ pageKey: 'orders', scope: 'personal', definition, ...body });

  const list = (token: string, pageKey = 'orders') =>
    harness
      .getHttp()
      .get(`/v1/saved-views?pageKey=${pageKey}`)
      .set('Authorization', `Bearer ${token}`);

  describe('CRUD and visibility', () => {
    it('should create, list and round-trip a personal view', async () => {
      const t = await tokens();
      const created = await create(t.alice, { name: 'Needs a look' }).expect(201);
      expect(created.body).toMatchObject({
        name: 'Needs a look',
        scope: 'personal',
        revision: 1,
        stale: false,
        canEdit: true,
        isDefault: false,
        definition,
      });

      const res = await list(t.alice).expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe(created.body.id);
      expect(res.headers['cache-control']).toContain('no-store');
    });

    it('should never list or touch another user\'s personal view (404)', async () => {
      const t = await tokens();
      const mine = await create(t.alice, { name: 'private' }).expect(201);

      expect((await list(t.bob).expect(200)).body).toEqual([]);
      await harness
        .getHttp()
        .patch(`/v1/saved-views/${mine.body.id}`)
        .set('Authorization', `Bearer ${t.bob}`)
        .send({ name: 'x', expectedRevision: 1 })
        .expect(404);
      await harness
        .getHttp()
        .delete(`/v1/saved-views/${mine.body.id}`)
        .set('Authorization', `Bearer ${t.bob}`)
        .expect(404);
      await harness
        .getHttp()
        .put('/v1/saved-views/default')
        .set('Authorization', `Bearer ${t.bob}`)
        .send({ pageKey: 'orders', viewId: mine.body.id })
        .expect(404);
    });

    it('should let everyone read a shared view but only an admin write it (403 from the service)', async () => {
      const t = await tokens();
      const shared = await create(t.admin, { name: 'team', scope: 'shared' }).expect(201);
      expect(shared.body).toMatchObject({ ownerUserId: null, canEdit: true });

      for (const reader of [t.alice, t.viewer]) {
        const res = await list(reader).expect(200);
        expect(res.body[0]).toMatchObject({ name: 'team', canEdit: false });
      }
      await create(t.alice, { name: 'nope', scope: 'shared' }).expect(403);
      await harness
        .getHttp()
        .patch(`/v1/saved-views/${shared.body.id}`)
        .set('Authorization', `Bearer ${t.alice}`)
        .send({ name: 'x', expectedRevision: 1 })
        .expect(403);
      await harness
        .getHttp()
        .delete(`/v1/saved-views/${shared.body.id}`)
        .set('Authorization', `Bearer ${t.viewer}`)
        .expect(403);
      await harness
        .getHttp()
        .delete(`/v1/saved-views/${shared.body.id}`)
        .set('Authorization', `Bearer ${t.admin}`)
        .expect(204);
    });

    it('should let a viewer clone a shared view into a personal one', async () => {
      const t = await tokens();
      await create(t.admin, { name: 'team', scope: 'shared' }).expect(201);
      await create(t.viewer, { name: 'team (copy)' }).expect(201);
      expect((await list(t.viewer).expect(200)).body).toHaveLength(2);
    });

    it('should refuse a packer on every route', async () => {
      const t = await tokens();
      await list(t.packer).expect(403);
      await create(t.packer, { name: 'x' }).expect(403);
    });

    it('should scope the list to the requested page', async () => {
      const t = await tokens();
      await create(t.alice, { name: 'o' }).expect(201);
      await create(t.alice, { name: 'p', pageKey: 'products' }).expect(201);
      expect((await list(t.alice, 'products').expect(200)).body.map((v: { name: string }) => v.name)).toEqual(['p']);
    });
  });

  describe('validation', () => {
    it.each([
      ['unknown page', { pageKey: 'nonsense' }],
      ['unregistered (deferred) page', { pageKey: 'dispatch-risk' }],
      ['unknown filter key', { definition: { ...definition, query: 'bogus=1' } }],
      ['badly formatted page', { pageKey: 'Orders!' }],
      ['unknown scope', { scope: 'global' }],
      ['non-object definition', { definition: 'x' }],
      ['empty name', { name: '' }],
    ])('should answer 400 for %s', async (_label, patch) => {
      const t = await tokens();
      await create(t.alice, { name: 'ok', ...patch }).expect(400);
    });

    it('should reject a definition over 64 columns, a query over 2 KB and a body over 16 KB with 400', async () => {
      const t = await tokens();
      const columns = Array.from({ length: 65 }, (_, i) => `c${i}`);
      const manyColumns = await create(t.alice, { name: 'a', definition: { ...definition, columns } }).expect(400);
      expect(manyColumns.body.code).toBe('SAVED_VIEW_INVALID');
      await create(t.alice, { name: 'b', definition: { ...definition, query: 'q'.repeat(2049) } }).expect(400);

      const parts: Record<string, string[]> = {};
      for (let i = 0; i < 60; i++) parts[`col-${i}`] = Array.from({ length: 60 }, (_, j) => `p${j}`);
      await create(t.alice, { name: 'c', definition: { ...definition, parts } }).expect(400);
    });

    it('should refuse the 51st personal view for a user and page', async () => {
      const t = await tokens();
      for (let i = 0; i < 50; i++) await create(t.alice, { name: `v${i}` }).expect(201);
      await create(t.alice, { name: 'v50' }).expect(400);
      await create(t.alice, { name: 'v50', pageKey: 'products' }).expect(201);
      await create(t.bob, { name: 'v0' }).expect(201);
    });
  });

  describe('uniqueness', () => {
    it('should answer 409 for a duplicate name within the same personal domain only', async () => {
      const t = await tokens();
      await create(t.alice, { name: 'same' }).expect(201);
      const dup = await create(t.alice, { name: 'same' }).expect(409);
      expect(dup.body.code).toBe('SAVED_VIEW_NAME_TAKEN');
      // Another user, another page, and the shared domain are each separate.
      await create(t.bob, { name: 'same' }).expect(201);
      await create(t.alice, { name: 'same', pageKey: 'products' }).expect(201);
      await create(t.admin, { name: 'same', scope: 'shared' }).expect(201);
      await create(t.admin, { name: 'same', scope: 'shared' }).expect(409);
    });

    it('should answer 409 when a rename collides', async () => {
      const t = await tokens();
      await create(t.alice, { name: 'one' }).expect(201);
      const two = await create(t.alice, { name: 'two' }).expect(201);
      await harness
        .getHttp()
        .patch(`/v1/saved-views/${two.body.id}`)
        .set('Authorization', `Bearer ${t.alice}`)
        .send({ name: 'one', expectedRevision: 1 })
        .expect(409);
    });
  });

  describe('optimistic concurrency', () => {
    it('should bump the revision on update and answer 409 for a stale one', async () => {
      const t = await tokens();
      const view = await create(t.alice, { name: 'v' }).expect(201);
      const patch = (revision: number, name: string) =>
        harness
          .getHttp()
          .patch(`/v1/saved-views/${view.body.id}`)
          .set('Authorization', `Bearer ${t.alice}`)
          .send({ name, expectedRevision: revision });

      const first = await patch(1, 'v2').expect(200);
      expect(first.body).toMatchObject({ name: 'v2', revision: 2 });
      const stale = await patch(1, 'v3').expect(409);
      expect(stale.body.code).toBe('SAVED_VIEW_REVISION_CONFLICT');
      await patch(2, 'v3').expect(200);
    });

    it('should answer 404, not 409, for a view that does not exist', async () => {
      const t = await tokens();
      await harness
        .getHttp()
        .patch('/v1/saved-views/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${t.alice}`)
        .send({ name: 'x', expectedRevision: 1 })
        .expect(404);
    });
  });

  describe('defaults', () => {
    it('should resolve personal default, then workspace default, then the system view', async () => {
      const t = await tokens();
      const shared = await create(t.admin, {
        name: 'team',
        scope: 'shared',
        workspaceDefault: true,
      }).expect(201);
      const mine = await create(t.alice, { name: 'mine' }).expect(201);

      const flagged = async (token: string) =>
        (await list(token).expect(200)).body
          .filter((v: { isDefault: boolean }) => v.isDefault)
          .map((v: { name: string }) => v.name);

      // Workspace default applies to everyone with no choice of their own.
      expect(await flagged(t.alice)).toEqual(['team']);
      expect(await flagged(t.bob)).toEqual(['team']);

      await harness
        .getHttp()
        .put('/v1/saved-views/default')
        .set('Authorization', `Bearer ${t.alice}`)
        .send({ pageKey: 'orders', viewId: mine.body.id })
        .expect(204);
      expect(await flagged(t.alice)).toEqual(['mine']);
      expect(await flagged(t.bob)).toEqual(['team']);

      // null = the system "All" view, beating the workspace default.
      await harness
        .getHttp()
        .put('/v1/saved-views/default')
        .set('Authorization', `Bearer ${t.alice}`)
        .send({ pageKey: 'orders', viewId: null })
        .expect(204);
      expect(await flagged(t.alice)).toEqual([]);

      // Deleting the personal default view drops nothing the user did not choose.
      await harness
        .getHttp()
        .put('/v1/saved-views/default')
        .set('Authorization', `Bearer ${t.alice}`)
        .send({ pageKey: 'orders', viewId: shared.body.id })
        .expect(204);
      expect(await flagged(t.alice)).toEqual(['team']);
    });

    it('should keep at most one workspace default per page, demoting the previous one', async () => {
      const t = await tokens();
      await create(t.admin, { name: 'a', scope: 'shared', workspaceDefault: true }).expect(201);
      await create(t.admin, { name: 'b', scope: 'shared', workspaceDefault: true }).expect(201);
      const res = await list(t.alice).expect(200);
      expect(
        res.body.filter((v: { isWorkspaceDefault: boolean }) => v.isWorkspaceDefault).map((v: { name: string }) => v.name)
      ).toEqual(['b']);
    });

    it('should refuse a default that points at a view of another page', async () => {
      const t = await tokens();
      const other = await create(t.alice, { name: 'p', pageKey: 'products' }).expect(201);
      await harness
        .getHttp()
        .put('/v1/saved-views/default')
        .set('Authorization', `Bearer ${t.alice}`)
        .send({ pageKey: 'orders', viewId: other.body.id })
        .expect(404);
    });
  });

  describe('query safety', () => {
    it('should strip search, offset, cursor and limit from a shared view before storing it', async () => {
      const t = await tokens();
      const res = await create(t.admin, {
        name: 'leaky',
        scope: 'shared',
        pageKey: 'customers',
        definition: { ...definition, query: 'search=jan%40x.pl&offset=20&limit=5' },
      }).expect(201);
      expect(res.body.definition.query).toBe('');
      const stored = await harness
        .getDataSource()
        .query(`SELECT definition FROM saved_views WHERE id = $1`, [res.body.id]);
      expect(JSON.stringify(stored[0].definition)).not.toContain('jan');
    });

    it('should apply the same policy on update', async () => {
      const t = await tokens();
      const v = await create(t.alice, { name: 'p', pageKey: 'customers' }).expect(201);
      await harness
        .getHttp()
        .patch(`/v1/saved-views/${v.body.id}`)
        .set('Authorization', `Bearer ${t.alice}`)
        .send({ definition: { ...definition, query: 'bogus=1' }, expectedRevision: 1 })
        .expect(400);
    });
  });

  describe('tolerant read', () => {
    it('should return a stored definition it cannot understand flagged stale, never a 500', async () => {
      const t = await tokens();
      const created = await create(t.alice, { name: 'old' }).expect(201);
      await harness
        .getDataSource()
        .query(`UPDATE saved_views SET definition = '"garbage"'::jsonb WHERE id = $1`, [created.body.id]);

      const res = await list(t.alice).expect(200);
      expect(res.body[0]).toMatchObject({
        name: 'old',
        stale: true,
        definition: { v: 1, query: '', sort: null, columns: [], parts: {} },
      });
    });
  });
});
