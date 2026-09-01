/**
 * Router Enablement Guard + First-Run Location Bootstrap Integration Test (#2407)
 *
 * REVIEW D3: routing needs locations that exist on no current install. Enabling
 * a router against zero locations makes every line unfulfillable, so the feature
 * reads as broken when it is merely unconfigured.
 *
 * Every assertion here is written against the guard's own behaviour, through the
 * HTTP surface an operator actually reaches. The refusal case carries an
 * explicit CONTROL — the identical request after a bootstrap — because a 400
 * alone cannot distinguish "refused for the location count" from "refused
 * because the payload was malformed".
 *
 * @module apps/api/test/integration
 */
import {
  getTestHarness,
  resetTestHarness,
  teardownTestHarness,
  IntegrationTestHarness,
} from './setup';
import { createPrestashopConnectionDto } from './fixtures/connection.fixtures';
import { loginAsAdmin } from './helpers/test-auth.helper';

interface BootstrapBody {
  created: Array<{ id: string; code: string; status: string }>;
  existingCodes: string[];
}

describe('Router enablement guard + location bootstrap (integration)', () => {
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

  /**
   * MERGED into the fixture's config, never substituted for it: the PrestaShop
   * plugin registers a config-shape validator (#586) whose required keys live in
   * that fixture, so replacing the object is a 400 for an unrelated reason —
   * which would make every refusal assertion below untrustworthy.
   */
  function connectionDto(name: string, config: object): object {
    const dto = createPrestashopConnectionDto({ name });
    return { ...dto, config: { ...dto.config, ...config } };
  }

  async function bootstrap(token: string): Promise<BootstrapBody> {
    const response = await harness
      .getHttp()
      .post('/v1/inventory/locations/bootstrap')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    return response.body as BootstrapBody;
  }

  async function activeLocationCount(token: string): Promise<number> {
    const response = await harness
      .getHttp()
      .get('/v1/inventory/locations?status=active')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return (response.body as { total: number }).total;
  }

  it('refuses to enable routing while no location exists, with 400 and a remedy', async () => {
    const token = await loginAsAdmin(harness.getHttp(), harness.getDataSource());

    const refusal = await harness
      .getHttp()
      .post('/v1/connections')
      .set('Authorization', `Bearer ${token}`)
      .send(connectionDto('Routing shop', { sourcingAuthority: true }))
      // 400, not the 500 an unfulfillable-everything install would otherwise
      // read as. AC-1.
      .expect(400);

    // The message must name the remedy: a refusal an operator cannot act on
    // leaves them worse off than one that let them misconfigure.
    expect((refusal.body as { message: string }).message).toMatch(
      /at least one active inventory location/i
    );

    // ...and it wrote nothing.
    const listed = await harness
      .getHttp()
      .get('/v1/connections')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(listed.body as unknown[]).toHaveLength(0);
  });

  it('accepts the identical request once a location exists', async () => {
    // THE CONTROL for the test above. Same payload, same route, same user; the
    // only difference is the location count, so a 201 here is what makes the
    // 400 there attributable to the guard rather than to the request.
    const token = await loginAsAdmin(harness.getHttp(), harness.getDataSource());
    await bootstrap(token);

    await harness
      .getHttp()
      .post('/v1/connections')
      .set('Authorization', `Bearer ${token}`)
      .send(connectionDto('Routing shop', { sourcingAuthority: true }))
      .expect(201);
  });

  it('creates a connection that does not claim routing, at zero locations', async () => {
    // An install that never opted in is byte-identical to its pre-#2407 self.
    const token = await loginAsAdmin(harness.getHttp(), harness.getDataSource());

    await harness
      .getHttp()
      .post('/v1/connections')
      .set('Authorization', `Bearer ${token}`)
      .send(connectionDto('Ordinary shop', {}))
      .expect(201);
    expect(await activeLocationCount(token)).toBe(0);
  });

  it('bootstraps once and then creates nothing on a re-run', async () => {
    const token = await loginAsAdmin(harness.getHttp(), harness.getDataSource());

    const first = await bootstrap(token);
    expect(first.created).toHaveLength(1);
    expect(first.created[0].code).toBe('MAIN');
    // Minted ACTIVE, or the bootstrap could not satisfy the guard it exists to
    // unblock — `countActiveLocations` filters on exactly this.
    expect(first.created[0].status).toBe('active');
    expect(first.existingCodes).toEqual([]);
    expect(await activeLocationCount(token)).toBe(1);

    const second = await bootstrap(token);
    expect(second.created).toEqual([]);
    expect(second.existingCodes).toEqual(['MAIN']);
    // AC-2, asserted against the table rather than against the response: a
    // second row would be invisible in a response that reports only its own work.
    expect(await activeLocationCount(token)).toBe(1);
  });

  it('does not refuse an unrelated patch on a connection that already claims routing', async () => {
    // Enable-time only (D7), not a standing invariant. This would fail against a
    // naive guard that tests the claim without comparing it to persisted state.
    const token = await loginAsAdmin(harness.getHttp(), harness.getDataSource());
    await bootstrap(token);

    const created = await harness
      .getHttp()
      .post('/v1/connections')
      .set('Authorization', `Bearer ${token}`)
      .send(connectionDto('Routing shop', { sourcingAuthority: true }))
      .expect(201);
    const connectionId = (created.body as { id: string }).id;

    // Take the install back to zero active locations the way an operator can:
    // the guard deliberately does not reach into the inventory context to stop
    // this (ADR-053), and the readiness panel reports it instead.
    const listed = await harness
      .getHttp()
      .get('/v1/inventory/locations?status=active')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const locationId = (listed.body as { items: Array<{ id: string }> }).items[0].id;
    await harness
      .getHttp()
      .delete(`/v1/inventory/locations/${locationId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
    expect(await activeLocationCount(token)).toBe(0);

    // Carries `config` deliberately: the guard only runs inside the
    // config-present branch, so a name-only patch would skip it entirely and
    // assert nothing about D7.
    const dto = connectionDto('Routing shop renamed', { sourcingAuthority: true }) as {
      config: Record<string, unknown>;
    };
    await harness
      .getHttp()
      .patch(`/v1/connections/${connectionId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Routing shop renamed', config: dto.config })
      .expect(200);
  });

  it('treats a config it cannot read as no claim at all, rather than throwing', async () => {
    const token = await loginAsAdmin(harness.getHttp(), harness.getDataSource());

    // Neither a refusal nor a 500: a shape OpenLinker cannot read is not a
    // claim, and coercing it into one would refuse installs that never opted in.
    await harness
      .getHttp()
      .post('/v1/connections')
      .set('Authorization', `Bearer ${token}`)
      .send(connectionDto('Malformed shop', { sourcingAuthority: 'yes' }))
      .expect(201);
  });
});
