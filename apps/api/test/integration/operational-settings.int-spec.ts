/**
 * Operational Settings Integration Test
 *
 * Vertical slice for the operator-settable sweep pacing surface (#2651,
 * ADR-069):
 *
 *   - GET /operational-settings  → resolved values, each with its rung
 *   - PUT /operational-settings  → partial update (204)
 *
 * Three things live only at the boundary and cannot be proven by the unit
 * specs (which mock the repository):
 *
 *   1. the PUT → real-Postgres → GET round trip, including that the write
 *      lands on the `singleton` row rather than accumulating rows;
 *   2. the bound rejections (below `min`, above `absoluteMax`, and above a
 *      RECOMMENDED ceiling without `acknowledgeAboveRecommended`) actually
 *      surfacing as 400 through `withDomainExceptionMapping`;
 *   3. `@Roles('admin')` on both handlers.
 *
 * @module apps/api/test/integration
 */
import * as bcrypt from 'bcryptjs';
import { OPERATIONAL_SETTING_BOUNDS } from '@openlinker/core/operational-settings';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { IntegrationTestHarness } from './setup';
import { loginAsAdmin } from './helpers/test-auth.helper';

async function loginAsViewer(harness: IntegrationTestHarness): Promise<string> {
  const passwordHash = await bcrypt.hash('viewer-pass', 4);
  await harness
    .getDataSource()
    .query(
      `INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, 'viewer')`,
      ['ops-viewer', 'ops-viewer@example.com', passwordHash]
    );
  const response = await harness
    .getHttp()
    .post('/v1/auth/login')
    .send({ username: 'ops-viewer', password: 'viewer-pass' })
    .expect(200);
  return response.body.access_token as string;
}

describe('Operational Settings Integration', () => {
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

  describe('GET /operational-settings', () => {
    it('resolves every knob from the built-in default when no row exists', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());

      const res = await http
        .get('/v1/operational-settings')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.catalogueSweepBudget.value).toBe(
        OPERATIONAL_SETTING_BOUNDS.catalogueSweepBudget.default
      );
      expect(res.body.catalogueSweepBudget.source).toBe('default');
      expect(res.body.sweepPageSize.value).toBe(OPERATIONAL_SETTING_BOUNDS.sweepPageSize.default);
      expect(res.body.updatedAt).toBeNull();
      expect(res.body.deletionAuditAlwaysEnabled).toBe(true);
      expect(res.headers['cache-control']).toContain('no-store');
    });

    it('publishes the bounds table so a client never restates a limit', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());

      const res = await http
        .get('/v1/operational-settings')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.bounds.sweepPageSize).toEqual({
        ...OPERATIONAL_SETTING_BOUNDS.sweepPageSize,
      });
    });

    it('returns 403 to non-admin callers', async () => {
      const http = harness.getHttp();
      const viewerToken = await loginAsViewer(harness);

      await http
        .get('/v1/operational-settings')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(403);
    });
  });

  describe('PUT /operational-settings', () => {
    it('round-trips a saved value through Postgres and reports the `setting` rung', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());

      await http
        .put('/v1/operational-settings')
        .set('Authorization', `Bearer ${token}`)
        .send({ catalogueSweepBudget: 250, sweepPageSize: 50 })
        .expect(204);

      const res = await http
        .get('/v1/operational-settings')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.catalogueSweepBudget).toMatchObject({ value: 250, source: 'setting' });
      expect(res.body.sweepPageSize).toMatchObject({ value: 50, source: 'setting' });
      expect(res.body.updatedAt).toEqual(expect.any(String));
      expect(res.body.updatedBy).not.toBeNull();

      // An untouched knob keeps falling through to its default.
      expect(res.body.deletionAuditBudget.source).toBe('default');
    });

    it('keeps exactly one row across repeated writes (singleton constraint)', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());

      await http
        .put('/v1/operational-settings')
        .set('Authorization', `Bearer ${token}`)
        .send({ catalogueSweepBudget: 300 })
        .expect(204);
      await http
        .put('/v1/operational-settings')
        .set('Authorization', `Bearer ${token}`)
        .send({ catalogueSweepBudget: 400 })
        .expect(204);

      const rows = await harness
        .getDataSource()
        .query<Array<{ id: string; catalogue_sweep_budget: number }>>(
          `SELECT id, catalogue_sweep_budget FROM operational_settings`
        );
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe('singleton');
      expect(rows[0].catalogue_sweep_budget).toBe(400);
    });

    it('leaves an omitted field alone and clears an explicitly null one back to the default rung', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());

      await http
        .put('/v1/operational-settings')
        .set('Authorization', `Bearer ${token}`)
        .send({ catalogueSweepBudget: 250, inventorySweepBudget: 60 })
        .expect(204);

      // Omits catalogueSweepBudget, explicitly clears inventorySweepBudget.
      await http
        .put('/v1/operational-settings')
        .set('Authorization', `Bearer ${token}`)
        .send({ inventorySweepBudget: null })
        .expect(204);

      const res = await http
        .get('/v1/operational-settings')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.catalogueSweepBudget).toMatchObject({ value: 250, source: 'setting' });
      expect(res.body.inventorySweepBudget).toMatchObject({
        value: OPERATIONAL_SETTING_BOUNDS.inventorySweepBudget.default,
        source: 'default',
      });
    });

    it('rejects a value below the minimum with 400', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());

      await http
        .put('/v1/operational-settings')
        .set('Authorization', `Bearer ${token}`)
        .send({ catalogueSweepBudget: 0 })
        .expect(400);
    });

    it('rejects a value above the absolute ceiling with 400, even when acknowledged', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());
      const overAbsolute = OPERATIONAL_SETTING_BOUNDS.sweepPageSize.absoluteMax + 1;

      await http
        .put('/v1/operational-settings')
        .set('Authorization', `Bearer ${token}`)
        .send({ sweepPageSize: overAbsolute, acknowledgeAboveRecommended: true })
        .expect(400);

      // Nothing was persisted by the refused write.
      const rows = await harness
        .getDataSource()
        .query<Array<{ sweep_page_size: number | null }>>(
          `SELECT sweep_page_size FROM operational_settings`
        );
      expect(rows.every((row) => row.sweep_page_size !== overAbsolute)).toBe(true);
    });

    it('refuses a value above the RECOMMENDED ceiling unless the caller acknowledges it', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());
      const bound = OPERATIONAL_SETTING_BOUNDS.sweepPageSize;
      const aboveRecommended = bound.recommendedMax + 1;
      expect(aboveRecommended).toBeLessThanOrEqual(bound.absoluteMax);

      await http
        .put('/v1/operational-settings')
        .set('Authorization', `Bearer ${token}`)
        .send({ sweepPageSize: aboveRecommended })
        .expect(400);

      await http
        .put('/v1/operational-settings')
        .set('Authorization', `Bearer ${token}`)
        .send({ sweepPageSize: aboveRecommended, acknowledgeAboveRecommended: true })
        .expect(204);

      const res = await http
        .get('/v1/operational-settings')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.sweepPageSize).toMatchObject({
        value: aboveRecommended,
        source: 'setting',
        aboveRecommended: true,
      });
    });

    it('rejects an unusable deletion-audit cadence with 400', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());

      await http
        .put('/v1/operational-settings')
        .set('Authorization', `Bearer ${token}`)
        .send({ deletionAuditCadence: 'not-a-cron' })
        .expect(400);
    });

    it('returns 403 to non-admin callers', async () => {
      const http = harness.getHttp();
      const viewerToken = await loginAsViewer(harness);

      await http
        .put('/v1/operational-settings')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ catalogueSweepBudget: 250 })
        .expect(403);
    });
  });
});
