/**
 * Automation run-read routing (#2385)
 *
 * ## What it covers, and why a unit test cannot
 *
 * `AutomationsController` declares `@Get('runs')` BEFORE `@Get(':id')`. Nest
 * matches in declaration order, so reversing them makes `/v1/automations/runs`
 * resolve as a rule lookup with `id === 'runs'` — a 404 on a working endpoint.
 * The controller spec calls the handler methods directly and never goes through
 * the router, so it would stay green through exactly that break.
 *
 * @module apps/api/test/integration/automation
 */
import { getTestHarness, resetTestHarness, teardownTestHarness } from '../setup';
import type { IntegrationTestHarness } from '../setup';
import { loginAsAdmin } from '../helpers/test-auth.helper';

describe('Automation run reads (routing)', () => {
  let harness: IntegrationTestHarness;
  let token: string;

  beforeAll(async () => {
    harness = await getTestHarness();
    // Once per file — `loginAsAdmin` plain-INSERTs a fixed admin user, so a
    // second call violates the users unique constraint.
    token = await loginAsAdmin(harness.getHttp(), harness.getDataSource());
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('should resolve /automations/runs as the feed with recording available', async () => {
    const response = await harness
      .getHttp()
      .get('/v1/automations/runs')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // A rule lookup would 404. An envelope proves the static route won.
    expect(Array.isArray(response.body.runs)).toBe(true);
    // `recordingAvailable` is the single switch that retires the "not recorded
    // in this build" banner — and asserting the literal `true` subsumes the
    // typeof check a second request was making against the same endpoint.
    expect(response.body.recordingAvailable).toBe(true);
  });

  it('should refuse a subject filter that names no recognised kind', async () => {
    await harness
      .getHttp()
      .get('/v1/automations/runs?subjectId=ol_order_1')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('should still resolve /automations/:id for a real rule id', async () => {
    // The dynamic route must keep working beside the static one.
    await harness
      .getHttp()
      .get('/v1/automations/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  // ── Malformed ids (#2358 review I3) ─────────────────────────────────────
  //
  // The probes above all use a WELL-FORMED uuid, which is the one shape that
  // hides the bug: `internalId` columns are `TEXT`, so a well-formed-but-absent
  // uuid selects nothing and 404s honestly. A MALFORMED id reached the query
  // unvalidated. These assert a 4xx — never a 500 — so the pipes cannot be
  // dropped without the suite noticing.
  describe.each([
    ['GET', '/v1/automations/not-a-uuid'],
    ['GET', '/v1/automations/not-a-uuid/runs'],
    ['GET', '/v1/automations/runs/not-a-uuid'],
    ['GET', '/v1/automations/runs?ruleId=not-a-uuid'],
    ['DELETE', '/v1/automations/not-a-uuid'],
    ['POST', '/v1/automations/runs/not-a-uuid/retry'],
    ['POST', '/v1/automations/runs/not-a-uuid/dismiss'],
  ])('%s %s', (method, url) => {
    it('should refuse a malformed id with a 4xx, never a 500', async () => {
      const http = harness.getHttp();
      const request = method === 'GET' ? http.get(url) : method === 'DELETE' ? http.delete(url) : http.post(url);
      const response = await request.set('Authorization', `Bearer ${token}`).send();
      expect(response.status).toBe(400);
    });
  });

  it('should ignore a non-numeric limit rather than paging on NaN (#2358 I7)', async () => {
    const response = await harness
      .getHttp()
      .get('/v1/automations/runs?limit=abc')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.limit).toBeGreaterThan(0);
    expect(Array.isArray(response.body.runs)).toBe(true);
  });
});
