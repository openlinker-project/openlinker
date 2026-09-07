/**
 * OMS Sourcing Rules API Integration Test (#2953)
 *
 * The vertical slice the issue's acceptance criteria name: an operator authors
 * an ORDERED filter/sort list over HTTP, and the router then evaluates it in
 * that order.
 *
 * Four things here exist only against real Postgres and cannot be proven by the
 * unit specs:
 *
 *  - the not-retired scope. A rule whose `effectiveTo` lies in the FUTURE is
 *    still evaluated by `listActiveRules`, so it must also be listed and
 *    reorderable. An implementation scoping on `effectiveTo IS NULL` — the
 *    unique index's predicate, which is the obvious thing to reach for — passes
 *    every other assertion in this file and fails only that one;
 *  - the `UQ_oms_routing_rules_live_name` partial unique index surfacing as a
 *    409 rather than a raw driver error;
 *  - that the authored order really is the evaluation order, asserted by
 *    reading back through `RoutingRuleSourcePort` — the router's own seam —
 *    rather than through the API that just wrote it;
 *  - that a rule owned by another connection answers 404, not 403.
 *
 * @module apps/api/test/integration
 */
import { ROUTING_RULE_SOURCE_TOKEN, type RoutingRuleSourcePort } from '@openlinker/oms';

import { loginAsAdmin } from './helpers/test-auth.helper';
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';

interface RuleBody {
  id: string;
  position: number;
  kind: string;
  name: string;
  afterAction: string;
  priorityLocationIds: string[];
  effectiveTo: string | null;
  recognised: boolean;
}

describe('OMS sourcing rules API (integration)', () => {
  let harness: IntegrationTestHarness;
  let token: string;

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  beforeEach(async () => {
    // Once per test: `loginAsAdmin` plain-INSERTs a fixed admin user, so a
    // second call in the same test violates the users unique constraint.
    token = await loginAsAdmin(harness.getHttp(), harness.getDataSource());
  });

  async function createOmsConnection(name = 'OpenLinker OMS'): Promise<string> {
    const response = await harness
      .getHttp()
      .post('/v1/connections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name, platformType: 'openlinker', config: {} })
      .expect(201);
    return (response.body as { id: string }).id;
  }

  function rulesUrl(connectionId: string, suffix = ''): string {
    return `/v1/connections/${connectionId}/sourcing-rules${suffix}`;
  }

  async function createRule(
    connectionId: string,
    body: Record<string, unknown>
  ): Promise<RuleBody> {
    const response = await harness
      .getHttp()
      .post(rulesUrl(connectionId))
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(201);
    return response.body as RuleBody;
  }

  function readRouterRuleset(connectionId: string, now = new Date()) {
    return harness
      .getApp()
      .get<RoutingRuleSourcePort>(ROUTING_RULE_SOURCE_TOKEN)
      .listActiveRules(connectionId, now);
  }

  it('should author an ordered ruleset the router then evaluates in that order', async () => {
    const connectionId = await createOmsConnection();

    const inStock = await createRule(connectionId, {
      position: 10,
      kind: 'filter',
      name: 'in-stock',
      afterAction: 'quantity-split',
    });
    const nearest = await createRule(connectionId, {
      position: 20,
      kind: 'sort',
      name: 'nearest',
      afterAction: 'line-split',
    });

    // The API's own order…
    const listed = await harness
      .getHttp()
      .get(rulesUrl(connectionId))
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((listed.body as RuleBody[]).map((rule) => rule.name)).toEqual(['in-stock', 'nearest']);

    // …matches the ROUTER's, which is the claim that matters.
    expect((await readRouterRuleset(connectionId)).map((rule) => rule.name)).toEqual([
      'in-stock',
      'nearest',
    ]);

    // Reorder, exhaustively, and re-read through the router's own seam.
    const reordered = await harness
      .getHttp()
      .put(rulesUrl(connectionId, '/order'))
      .set('Authorization', `Bearer ${token}`)
      .send({ ruleIds: [nearest.id, inStock.id] })
      .expect(200);

    expect((reordered.body as RuleBody[]).map((rule) => [rule.name, rule.position])).toEqual([
      ['nearest', 1],
      ['in-stock', 2],
    ]);
    expect((await readRouterRuleset(connectionId)).map((rule) => rule.name)).toEqual([
      'nearest',
      'in-stock',
    ]);
  });

  it('should include a rule retiring in the FUTURE in both the list and the reorder set', async () => {
    // The regression this file exists for. `effectiveTo IS NULL` is the unique
    // index's predicate and answers a different question: a rule retiring
    // tomorrow is evaluated by the router today, so scoping the operator
    // surface on it would leave an actively-routing rule unorderable, silently.
    const connectionId = await createOmsConnection();
    const retiringTomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const future = await createRule(connectionId, {
      position: 1,
      kind: 'filter',
      name: 'in-stock',
      afterAction: 'no-split',
      effectiveTo: retiringTomorrow,
    });
    const plain = await createRule(connectionId, {
      position: 2,
      kind: 'sort',
      name: 'nearest',
      afterAction: 'no-split',
    });

    const listed = await harness
      .getHttp()
      .get(rulesUrl(connectionId))
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((listed.body as RuleBody[]).map((rule) => rule.id).sort()).toEqual(
      [future.id, plain.id].sort()
    );

    // And it must be nameable in a reorder — a list omitting it would be
    // refused as non-exhaustive.
    await harness
      .getHttp()
      .put(rulesUrl(connectionId, '/order'))
      .set('Authorization', `Bearer ${token}`)
      .send({ ruleIds: [plain.id, future.id] })
      .expect(200);
  });

  it('should exclude an already-retired rule unless includeSuperseded is set', async () => {
    const connectionId = await createOmsConnection();
    await createRule(connectionId, {
      position: 1,
      kind: 'filter',
      name: 'in-stock',
      afterAction: 'no-split',
      effectiveTo: new Date(Date.now() - 60_000).toISOString(),
    });

    const defaultList = await harness
      .getHttp()
      .get(rulesUrl(connectionId))
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(defaultList.body).toEqual([]);

    const withHistory = await harness
      .getHttp()
      .get(rulesUrl(connectionId, '?includeSuperseded=true'))
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(withHistory.body).toHaveLength(1);
  });

  it('should answer 409 when a live rule already claims the same kind and name', async () => {
    const connectionId = await createOmsConnection();
    const body = { position: 1, kind: 'filter', name: 'in-stock', afterAction: 'no-split' };

    await createRule(connectionId, body);

    await harness
      .getHttp()
      .post(rulesUrl(connectionId))
      .set('Authorization', `Bearer ${token}`)
      .send({ ...body, position: 2 })
      .expect(409);
  });

  it('should let a retired rule coexist with its replacement', async () => {
    // The partial index is what makes this legal, and it is why PATCHing
    // `effectiveTo` is the non-destructive alternative to DELETE.
    const connectionId = await createOmsConnection();
    const original = await createRule(connectionId, {
      position: 1,
      kind: 'filter',
      name: 'in-stock',
      afterAction: 'no-split',
    });

    await harness
      .getHttp()
      .patch(rulesUrl(connectionId, `/${original.id}`))
      .set('Authorization', `Bearer ${token}`)
      .send({ effectiveTo: new Date(Date.now() - 60_000).toISOString() })
      .expect(200);

    await harness
      .getHttp()
      .post(rulesUrl(connectionId))
      .set('Authorization', `Bearer ${token}`)
      .send({ position: 1, kind: 'filter', name: 'in-stock', afterAction: 'quantity-split' })
      .expect(201);

    expect(await readRouterRuleset(connectionId)).toHaveLength(1);
  });

  it('should refuse a non-exhaustive reorder and write nothing', async () => {
    const connectionId = await createOmsConnection();
    const first = await createRule(connectionId, {
      position: 10,
      kind: 'filter',
      name: 'in-stock',
      afterAction: 'no-split',
    });
    const second = await createRule(connectionId, {
      position: 20,
      kind: 'sort',
      name: 'nearest',
      afterAction: 'no-split',
    });

    const refusal = await harness
      .getHttp()
      .put(rulesUrl(connectionId, '/order'))
      .set('Authorization', `Bearer ${token}`)
      .send({ ruleIds: [second.id] })
      .expect(409);
    expect((refusal.body as { missingRuleIds: string[] }).missingRuleIds).toEqual([first.id]);

    // Nothing written: the original positions survive.
    const listed = await harness
      .getHttp()
      .get(rulesUrl(connectionId))
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((listed.body as RuleBody[]).map((rule) => rule.position)).toEqual([10, 20]);
  });

  it("should answer 404, not 403, for a rule belonging to another connection", async () => {
    const owner = await createOmsConnection('OMS A');
    const other = await createOmsConnection('OMS B');
    const rule = await createRule(owner, {
      position: 1,
      kind: 'filter',
      name: 'in-stock',
      afterAction: 'no-split',
    });

    // A 403 would confirm the guessed id names a real rule somewhere.
    await harness
      .getHttp()
      .get(rulesUrl(other, `/${rule.id}`))
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    await harness
      .getHttp()
      .delete(rulesUrl(other, `/${rule.id}`))
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('should refuse a kind/name pair the router could never evaluate', async () => {
    const connectionId = await createOmsConnection();

    // Both are members of the closed vocabulary, so the DTO's @IsIn accepts it.
    await harness
      .getHttp()
      .post(rulesUrl(connectionId))
      .set('Authorization', `Bearer ${token}`)
      .send({ position: 1, kind: 'filter', name: 'nearest', afterAction: 'no-split' })
      .expect(400);

    expect(await readRouterRuleset(connectionId)).toEqual([]);
  });

  it('should delete a rule and leave the router with nothing to evaluate', async () => {
    const connectionId = await createOmsConnection();
    const rule = await createRule(connectionId, {
      position: 1,
      kind: 'filter',
      name: 'in-stock',
      afterAction: 'no-split',
    });

    await harness
      .getHttp()
      .delete(rulesUrl(connectionId, `/${rule.id}`))
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    expect(await readRouterRuleset(connectionId)).toEqual([]);
  });
});
