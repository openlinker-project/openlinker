/**
 * OMS Routing Dry-Run Integration Test (#2954)
 *
 * What only real Postgres and the real Nest graph can prove:
 *
 *  - the dry run COMMITS NOTHING. A dry run that quietly called `route()` would
 *    pass every unit spec that mocks the router, and would write a
 *    `routing_decisions` intent row; so the row counts are read before and after;
 *  - the resolver, rule source and router are really wired for this controller
 *    (a missing provider is an API BOOT or request failure no unit spec sees);
 *  - a draft that could not be saved cannot be evaluated: it answers 400;
 *  - read-authorised: admin, operator and viewer may inspect; a packer is refused.
 *
 * @module apps/api/test/integration
 */
import {
  loginAsAdmin,
  loginAsOperator,
  loginAsPacker,
  loginAsViewer,
} from './helpers/test-auth.helper';
import { createTestConnection } from './helpers/test-connection.helper';
import type { IntegrationTestHarness } from './setup';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';

interface DryRunBody {
  input: { lines: unknown[]; shipTo: { mode: string; countryIso2: string } };
  saved: {
    candidates: unknown[];
    unfulfillable: Array<{ reason: string }>;
    explanation: unknown[];
  };
  draft?: unknown;
  changedLines?: unknown[];
}

describe('OMS routing dry run (integration)', () => {
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

  async function createConnection(token: string, platformType: string): Promise<string> {
    const response = await harness
      .getHttp()
      .post('/v1/connections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `${platformType} conn`, platformType, config: {} })
      .expect(201);
    return (response.body as { id: string }).id;
  }

  async function count(table: string): Promise<number> {
    const raw: unknown = await harness
      .getDataSource()
      .query(`SELECT COUNT(*)::int AS n FROM "${table}"`);
    const rows = raw as Array<{ n: number }>;
    return rows[0]?.n ?? 0;
  }

  const basket = {
    lines: [{ productVariantId: 'ol_variant_dry_run', quantity: 2 }],
    countryIso2: 'PL',
    postalCode: '61-000',
  };

  it('should answer an evaluation for a basket and commit nothing', async () => {
    const token = await loginAsAdmin(harness.getHttp(), harness.getDataSource());
    const connectionId = await createConnection(token, 'openlinker');

    const decisionsBefore = await count('routing_decisions');
    const worksBefore = await count('fulfillment_works');

    const response = await harness
      .getHttp()
      .post(`/v1/connections/${connectionId}/sourcing-rules/dry-run`)
      .set('Authorization', `Bearer ${token}`)
      .send({ basket })
      .expect(200);

    const body = response.body as DryRunBody;
    // No locations exist, so the line cannot be sourced - reported, not thrown.
    expect(body.saved.unfulfillable).toHaveLength(1);
    expect(body.saved.unfulfillable[0]?.reason).toEqual(expect.any(String));
    expect(body.input.shipTo.countryIso2).toBe('PL');
    expect(body.draft).toBeUndefined();

    expect(await count('routing_decisions')).toBe(decisionsBefore);
    expect(await count('fulfillment_works')).toBe(worksBefore);
  });

  it('should compare a draft ruleset with the saved one and still commit nothing', async () => {
    const token = await loginAsAdmin(harness.getHttp(), harness.getDataSource());
    const connectionId = await createConnection(token, 'openlinker');
    const decisionsBefore = await count('routing_decisions');

    const response = await harness
      .getHttp()
      .post(`/v1/connections/${connectionId}/sourcing-rules/dry-run`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        basket,
        draftRules: [
          {
            id: 'draft-1',
            position: 1,
            kind: 'filter',
            name: 'in-stock',
            afterAction: 'quantity-split',
          },
        ],
      })
      .expect(200);

    const body = response.body as DryRunBody;
    expect(body.draft).toBeDefined();
    expect(Array.isArray(body.changedLines)).toBe(true);
    expect(await count('routing_decisions')).toBe(decisionsBefore);
  });

  it('should refuse a draft rule that could not have been saved', async () => {
    const token = await loginAsAdmin(harness.getHttp(), harness.getDataSource());
    const connectionId = await createConnection(token, 'openlinker');

    await harness
      .getHttp()
      .post(`/v1/connections/${connectionId}/sourcing-rules/dry-run`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        basket,
        draftRules: [
          {
            id: 'bad',
            position: 1,
            kind: 'filter',
            name: 'nearest',
            afterAction: 'quantity-split',
          },
        ],
      })
      .expect(400);
  });

  it('should refuse a body naming neither an order nor a basket', async () => {
    const token = await loginAsAdmin(harness.getHttp(), harness.getDataSource());
    const connectionId = await createConnection(token, 'openlinker');

    await harness
      .getHttp()
      .post(`/v1/connections/${connectionId}/sourcing-rules/dry-run`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(400);
  });

  it('should refuse a connection that is not the OMS', async () => {
    const token = await loginAsAdmin(harness.getHttp(), harness.getDataSource());
    // Inserted directly: creating a real shop connection over HTTP needs
    // credentials, which this test is not about.
    const shop = await createTestConnection(harness.getDataSource());
    const connectionId = shop.id;

    await harness
      .getHttp()
      .post(`/v1/connections/${connectionId}/sourcing-rules/dry-run`)
      .set('Authorization', `Bearer ${token}`)
      .send({ basket })
      .expect(400);
  });

  it.each([
    ['operator', loginAsOperator],
    ['viewer', loginAsViewer],
  ])('should let a %s run the dry run: it is read-authorised', async (_role, login) => {
    const adminToken = await loginAsAdmin(harness.getHttp(), harness.getDataSource());
    const connectionId = await createConnection(adminToken, 'openlinker');
    const token = await login(harness.getHttp(), harness.getDataSource());

    const response = await harness
      .getHttp()
      .post(`/v1/connections/${connectionId}/sourcing-rules/dry-run`)
      .set('Authorization', `Bearer ${token}`)
      .send({ basket });

    expect(response.status).toBe(200);
  });

  it('should refuse a packer: the dry run is not a bench surface', async () => {
    const adminToken = await loginAsAdmin(harness.getHttp(), harness.getDataSource());
    const connectionId = await createConnection(adminToken, 'openlinker');
    const packerToken = await loginAsPacker(harness.getHttp(), harness.getDataSource());

    await harness
      .getHttp()
      .post(`/v1/connections/${connectionId}/sourcing-rules/dry-run`)
      .set('Authorization', `Bearer ${packerToken}`)
      .send({ basket })
      .expect(403);
  });
});
