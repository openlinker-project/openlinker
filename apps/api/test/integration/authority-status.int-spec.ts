/**
 * Authority Status API Integration Test (#2353)
 *
 * The vertical slice #2353's acceptance criteria name: status -> preview ->
 * apply -> status, plus the two refusals.
 *
 * The load-bearing assertion is the non-mutation one, and it is written as a
 * whole-response `toEqual` across a real preview rather than as an inspection of
 * the code path: preview runs the SAME pure mutation the apply does, against the
 * live configs, so "it does not write" is a claim only a re-read can support.
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

interface AuthorityRow {
  question: string;
  state: string;
  answer: { kind: string; candidateConnectionIds?: string[] };
  why: { kind: string };
}

interface StatusBody {
  rows: AuthorityRow[];
  attention: {
    counted: Array<{ reason: string; connectionIds: string[] }>;
    routine: unknown[];
    affectedOrderCount: number;
  };
  presets: Array<{ id: string; available: boolean; unavailableReason: string | null }>;
}

describe('Authority status API (integration)', () => {
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

  async function createConnection(token: string, name: string, config: object): Promise<string> {
    // MERGED into the fixture's config, never substituted for it: the PrestaShop
    // plugin registers a config-shape validator (#586) whose required keys live
    // in that fixture, so replacing the object is a 400.
    const dto = createPrestashopConnectionDto({ name });
    const response = await harness
      .getHttp()
      .post('/v1/connections')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...dto, config: { ...dto.config, ...config } })
      .expect(201);
    return (response.body as { id: string }).id;
  }

  async function getStatus(token: string): Promise<StatusBody> {
    const response = await harness
      .getHttp()
      .get('/v1/fulfillment-authority/status')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return response.body as StatusBody;
  }

  it('answers all seven questions with a why on a zero-config install', async () => {
    const token = await loginAsAdmin(harness.getHttp(), harness.getDataSource());

    const status = await getStatus(token);

    expect(status.rows).toHaveLength(7);
    for (const row of status.rows) {
      expect(row.answer.kind).toBeTruthy();
      expect(row.why.kind).toBeTruthy();
    }
    // Spec §2.3 — the page is never gated on having configured anything, and
    // #2356's A2-`none` regression: a single-location install counts zero.
    expect(status.attention.counted).toEqual([]);
    expect(status.attention.affectedOrderCount).toBe(0);
  });

  it('returns the unavailable preset with its reason rather than omitting it', async () => {
    const token = await loginAsAdmin(harness.getHttp(), harness.getDataSource());

    const status = await getStatus(token);

    expect(status.presets.map((preset) => preset.id)).toEqual([
      'leave-as-they-are',
      'openlinker-decides',
      'keep-other-system',
    ]);
    const cardThree = status.presets.find((preset) => preset.id === 'keep-other-system');
    expect(cardThree).toEqual({
      id: 'keep-other-system',
      available: false,
      unavailableReason: 'needs-a-system-that-can-take-over',
    });
  });

  it('previews a preset without committing anything', async () => {
    const token = await loginAsAdmin(harness.getHttp(), harness.getDataSource());
    await createConnection(token, 'Claiming shop', { sourcingAuthority: true });

    const before = await getStatus(token);
    const preview = await harness
      .getHttp()
      .post('/v1/fulfillment-authority/presets/preview')
      .set('Authorization', `Bearer ${token}`)
      .send({ presetId: 'openlinker-decides' })
      .expect(201);
    const after = await getStatus(token);

    expect((preview.body as { changes: Array<{ question: string }> }).changes).toHaveLength(1);
    // The whole response, not a field: anything the preview touched would show up.
    expect(after).toEqual(before);
  });

  it('applies a preset, and the assignment survives so the change is reversible', async () => {
    const token = await loginAsAdmin(harness.getHttp(), harness.getDataSource());
    const connectionId = await createConnection(token, 'Claiming shop', {
      sourcingAuthority: { enabled: true, isPrimary: true },
    });

    const before = await getStatus(token);
    expect(before.rows.find((row) => row.question === 'sourcing')?.state).toBe('resolved');

    const applied = await harness
      .getHttp()
      .put('/v1/fulfillment-authority/presets')
      .set('Authorization', `Bearer ${token}`)
      .send({ presetId: 'openlinker-decides' })
      .expect(200);

    expect((applied.body as StatusBody).rows.find((row) => row.question === 'sourcing')?.state).toBe(
      'default'
    );

    // Disabled, never deleted: `isPrimary` is still there, so re-enabling
    // restores exactly what the operator had configured.
    const connection = await harness
      .getHttp()
      .get(`/v1/connections/${connectionId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((connection.body as { config: Record<string, unknown> }).config.sourcingAuthority).toEqual(
      { enabled: false, isPrimary: true }
    );
  });

  it('refuses with 422 and writes nothing when the result would be ambiguous', async () => {
    const token = await loginAsAdmin(harness.getHttp(), harness.getDataSource());
    const first = await createConnection(token, 'Router A', { sourcingAuthority: true });
    const second = await createConnection(token, 'Router B', { sourcingAuthority: true });

    const before = await getStatus(token);
    expect(before.rows.find((row) => row.question === 'sourcing')?.state).toBe('ambiguous');
    expect(before.attention.counted[0].reason).toBe('sourcing-ambiguous');

    const refusal = await harness
      .getHttp()
      .put('/v1/fulfillment-authority/presets')
      .set('Authorization', `Bearer ${token}`)
      .send({ presetId: 'leave-as-they-are' })
      .expect(422);

    const named = (
      refusal.body as { ambiguities: Array<{ connectionIds: string[] }> }
    ).ambiguities[0].connectionIds;
    expect([...named].sort()).toEqual([first, second].sort());
    expect(await getStatus(token)).toEqual(before);
  });

  it('rejects an unavailable preset with a 400 naming its reason', async () => {
    const token = await loginAsAdmin(harness.getHttp(), harness.getDataSource());

    const response = await harness
      .getHttp()
      .put('/v1/fulfillment-authority/presets')
      .set('Authorization', `Bearer ${token}`)
      .send({ presetId: 'keep-other-system' })
      .expect(400);

    expect(response.body).toMatchObject({
      unavailableReason: 'needs-a-system-that-can-take-over',
    });
  });

  it('rejects an unknown preset id at the boundary', async () => {
    const token = await loginAsAdmin(harness.getHttp(), harness.getDataSource());

    await harness
      .getHttp()
      .put('/v1/fulfillment-authority/presets')
      .set('Authorization', `Bearer ${token}`)
      .send({ presetId: 'orchestrator' })
      .expect(400);
  });
});
