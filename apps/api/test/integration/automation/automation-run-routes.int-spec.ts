/**
 * Automation run-read routing (#2385)
 *
 * ## UNVERIFIED — written and committed, never executed
 *
 * Docker was wedged host-level when this shipped (the daemon hung on
 * `docker version`, not merely on container creation), so this spec has NOT been
 * run. It is committed rather than withheld because the property it covers is
 * the one thing the unit suite structurally cannot reach.
 *
 * ## What it covers, and why a unit test cannot
 *
 * `AutomationsController` declares `@Get('runs')` BEFORE `@Get(':id')`. Nest
 * matches in declaration order, so reversing them makes `/automations/runs`
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
    ({ token } = await loginAsAdmin(harness.getHttp()));
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('should resolve /automations/runs as the feed, not as a rule id', async () => {
    const response = await harness
      .getHttp()
      .get('/automations/runs')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // A rule lookup would 404. An envelope proves the static route won.
    expect(Array.isArray(response.body.runs)).toBe(true);
    expect(typeof response.body.recordingAvailable).toBe('boolean');
  });

  it('should report recording as available now that the write path is bound', async () => {
    // The single switch that retires the "not recorded in this build" banner.
    const response = await harness
      .getHttp()
      .get('/automations/runs')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.recordingAvailable).toBe(true);
  });

  it('should refuse a subject filter that names no recognised kind', async () => {
    await harness
      .getHttp()
      .get('/automations/runs?subjectId=ol_order_1')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('should still resolve /automations/:id for a real rule id', async () => {
    // The dynamic route must keep working beside the static one.
    await harness
      .getHttp()
      .get('/automations/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});
