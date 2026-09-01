/**
 * Credential-less OMS connection — create guard + render (#2405, ADR-055).
 *
 * The vertical slice for AC-3 and AC-4: an `openlinker` connection is created
 * over real HTTP with NO credentials, persists `credentialsRef: ''`, and
 * renders on the connections list without a null-guard sweep.
 *
 * Deliberately scoped to the **guard**, and deliberately separate from
 * `oms-connection-never-seeded.int-spec.ts`. This file uses the ordinary
 * harness, whose schema comes from TypeORM `synchronize` — which is exactly
 * why it cannot be the AC-2 test: the harness runs no migrations, so a
 * zero-rows assertion here would pass whether or not a seeding migration
 * exists. Two different questions, two different databases.
 *
 * @module apps/api/test/integration
 */
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { IntegrationTestHarness } from './setup';
import { loginAsAdmin } from './helpers/test-auth.helper';

const omsCreateBody = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: 'OpenLinker OMS',
  platformType: 'openlinker',
  config: { locationSetId: 'default' },
  ...overrides,
});

describe('Credential-less OMS connection (#2405)', () => {
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

  it('should create an OMS connection with NO credentials and persist an empty credentialsRef', async () => {
    const http = harness.getHttp();
    const dataSource = harness.getDataSource();
    const token = await loginAsAdmin(http, dataSource);

    const response = await http
      .post('/v1/connections')
      .set('Authorization', `Bearer ${token}`)
      .send(omsCreateBody())
      .expect(201);

    expect(response.body.platformType).toBe('openlinker');
    // The caller omitted `adapterKey`, and the service does not persist a
    // resolved one — it is resolved per read via
    // `getDefaultAdapterKey(platformType)`. That is precisely why the OMS
    // manifest must declare `isDefault: true`: without it this row could never
    // resolve an adapter at all. The registry side of that is asserted by
    // `apps/worker/test/integration/oms-module-boot.int-spec.ts`.
    expect(response.body.adapterKey).toBeNull();

    // `''`, never NULL: the column is `character varying NOT NULL`, and every
    // resolution site guards `if (credentialsRef)`.
    const [row] = (await dataSource.query(
      `SELECT "credentialsRef" FROM "connections" WHERE id = $1`,
      [response.body.id]
    )) as { credentialsRef: string }[];
    expect(row.credentialsRef).toBe('');
  });

  it('should render the credential-less row on the list with credentialsBacked false', async () => {
    // AC-4. This exercises `connection-response.dto.ts`'s unguarded
    // `credentialsRef.startsWith('db:')`, which runs PER ROW on every list
    // render and is the site that would throw on a `null`.
    const http = harness.getHttp();
    const dataSource = harness.getDataSource();
    const token = await loginAsAdmin(http, dataSource);

    await http
      .post('/v1/connections')
      .set('Authorization', `Bearer ${token}`)
      .send(omsCreateBody())
      .expect(201);

    const list = await http
      .get('/v1/connections')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const rows = (list.body.data ?? list.body) as { platformType: string; credentialsBacked: boolean }[];
    const oms = rows.find((c) => c.platformType === 'openlinker');
    expect(oms).toBeDefined();
    expect(oms?.credentialsBacked).toBe(false);
    // Never leaked to clients — the DTO exposes only the derived boolean.
    expect(oms).not.toHaveProperty('credentialsRef');
  });

  it('should REFUSE credential rotation on a credential-less connection, naming the db-backed reason', async () => {
    // Pins `updateCredentials`'s guard — the second unguarded
    // `.startsWith('db:')` site — rather than merely noting it as unchanged.
    // Asserting the MESSAGE matters: this route can 400 for several unrelated
    // reasons, so a bare status check would prove nothing about which branch ran.
    const http = harness.getHttp();
    const dataSource = harness.getDataSource();
    const token = await loginAsAdmin(http, dataSource);

    const created = await http
      .post('/v1/connections')
      .set('Authorization', `Bearer ${token}`)
      .send(omsCreateBody())
      .expect(201);

    const response = await http
      .put(`/v1/connections/${created.body.id}/credentials`)
      .set('Authorization', `Bearer ${token}`)
      .send({ credentials: { anything: 'X' } })
      .expect(400);

    expect(JSON.stringify(response.body)).toMatch(/does not have a db-backed credentials reference/);
  });

  it('should STILL reject a credential-requiring platform created with no credentials', async () => {
    // The negative control. Asserting the MESSAGE, not just the 400: the
    // "neither" guard now sits BELOW adapter-metadata resolution, so an
    // unregistered platformType would 400 for a different reason and this
    // assertion would pass for the wrong one. `prestashop` is registered in
    // the api test app.
    const http = harness.getHttp();
    const dataSource = harness.getDataSource();
    const token = await loginAsAdmin(http, dataSource);

    const response = await http
      .post('/v1/connections')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'No creds PrestaShop',
        platformType: 'prestashop',
        config: { baseUrl: 'https://example.com' },
      })
      .expect(400);

    expect(JSON.stringify(response.body)).toMatch(/Exactly one of/);
  });
});
