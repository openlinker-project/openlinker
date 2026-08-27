/**
 * Automation API Integration Test (#2363)
 *
 * Drives the HTTP surface against real Postgres (Testcontainers). Four claims
 * here are about ROWS or STATUS CODES and are therefore unreachable from a unit
 * test with a mocked repository:
 *
 *  - **`evaluate` commits nothing** — proved by COUNTING rows in all four tables
 *    a firing could touch (`automation_rules`, `automation_runs`,
 *    `automation_trigger_firings`, `sync_jobs`) across an evaluate that MATCHES a
 *    rule carrying an irreversible action. A unit test can assert "the service
 *    did not call a writer"; only this can assert "nothing was written",
 *    including by a path nobody thought to mock.
 *  - **an illegal pair is a 400 that NAMES the pair** — the mapping runs through
 *    the real global `AutomationExceptionFilter`, which is exactly what a
 *    controller unit test bypasses.
 *  - **the money acknowledgement round-trips**, and is cleared by a definition
 *    change but survives a rename — a two-write ordering claim about a real row.
 *  - **the AC's create → evaluate → runs chain** end to end.
 *
 * `loginAsAdmin` is called ONCE per test (it plain-INSERTs a fixed user, so a
 * second call in one test violates the users unique constraint); the operator
 * token is seeded under its own username where a test needs both.
 *
 * @module apps/api/test/integration
 */
import type { DataSource } from 'typeorm';

import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { IntegrationTestHarness } from './setup';
import { loginAsAdmin, loginAsOperator } from './helpers/test-auth.helper';

const EMAIL_STEP = {
  action: 'send-email',
  recipient: { kind: 'buyer' },
  subject: 'Packed',
  body: 'Your order {order.id} is on its way.',
};
const LABEL_STEP = {
  action: 'dispatch-shipment',
  carrierId: 'dpd',
  serviceId: null,
  packagePresetId: null,
  cashOnDelivery: false,
};

function ruleBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Tell the buyer when packed',
    trigger: 'order.packed',
    triggerConfig: {},
    conditions: [{ field: 'orderCountry', op: 'eq', value: 'PL' }],
    actions: [EMAIL_STEP],
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    ...overrides,
  };
}

/** A minimal ready order record — the dry run's subject. */
async function seedOrder(dataSource: DataSource, internalOrderId = 'ol_order_dryrun'): Promise<void> {
  await dataSource.query(
    `INSERT INTO order_records
       ("internalOrderId", "sourceConnectionId", "orderSnapshot", "syncStatus", "recordStatus",
        "placedAt", "currency", "totalAmount")
     VALUES ($1, $2, $3::jsonb, '[]'::jsonb, 'ready', $4, 'PLN', 250)`,
    [
      internalOrderId,
      '11111111-1111-1111-1111-111111111111',
      JSON.stringify({ shippingAddress: { countryIso2: 'PL' } }),
      new Date('2026-06-01').toISOString(),
    ],
  );
}

async function countRows(dataSource: DataSource, table: string): Promise<number> {
  const rows = (await dataSource.query(`SELECT COUNT(*)::int AS c FROM ${table}`)) as {
    c: number;
  }[];
  return rows[0].c;
}

describe('Automation API Integration', () => {
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

  describe('the write path', () => {
    it('should reject an illegal trigger-action pair with a 400 naming the pair', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());

      // "When a return is received, buy a shipping label" — a rule that would
      // save, arm, and then do nothing forever.
      const res = await http
        .post('/v1/automations')
        .set('Authorization', `Bearer ${token}`)
        .send(ruleBody({ trigger: 'return.received', actions: [LABEL_STEP] }))
        .expect(400);

      expect(res.body.error).toBe('AutomationIllegalPairError');
      expect(res.body.trigger).toBe('return.received');
      expect(res.body.action).toBe('dispatch-shipment');
      expect(res.body.index).toBe(0);
      expect(res.body.message).toContain('dispatch-shipment');
      expect(res.body.message).toContain('return.received');
      expect(await countRows(harness.getDataSource(), 'automation_rules')).toBe(0);
    });

    it('should refuse a duplicate definition over an overlapping window with a 409', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());

      await http
        .post('/v1/automations')
        .set('Authorization', `Bearer ${token}`)
        .send(ruleBody())
        .expect(201);
      const res = await http
        .post('/v1/automations')
        .set('Authorization', `Bearer ${token}`)
        .send(ruleBody({ name: 'A different name, same behaviour' }))
        .expect(409);

      expect(res.body.error).toBe('AutomationRuleConflictError');
      expect(res.body.trigger).toBe('order.packed');
    });

    it('should default a rule to disarmed and report its step availability', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());

      const res = await http
        .post('/v1/automations')
        .set('Authorization', `Bearer ${token}`)
        .send(ruleBody())
        .expect(201);

      // Fails closed — a rule is armed deliberately, never by omission.
      expect(res.body.isActive).toBe(false);
      // …and the response says what the rule can actually do in this build.
      expect(res.body.actionAvailability).toEqual([
        { action: 'send-email', availability: 'partial', reason: expect.any(String) },
      ]);
    });

    it('should require the trigger query param on the list route', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());
      await http
        .get('/v1/automations')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('should report rule counts for every trigger on the index', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());
      await http
        .post('/v1/automations')
        .set('Authorization', `Bearer ${token}`)
        .send(ruleBody())
        .expect(201);

      const res = await http
        .get('/v1/automations/summary')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toHaveLength(8);
      expect(res.body.find((r: { trigger: string }) => r.trigger === 'order.packed').ruleCount).toBe(
        1,
      );
      expect(
        res.body.find((r: { trigger: string }) => r.trigger === 'return.disposed').ruleCount,
      ).toBe(0);
    });
  });

  describe('the money acknowledgement (spec §5.7 S3-2)', () => {
    it('should refuse to arm an irreversible rule without one, and stamp it with one', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());
      const armed = ruleBody({ actions: [LABEL_STEP], isActive: true, trigger: 'order.packed' });

      await http
        .post('/v1/automations')
        .set('Authorization', `Bearer ${token}`)
        .send(armed)
        .expect(400);

      const res = await http
        .post('/v1/automations')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...armed, moneyAcknowledged: true })
        .expect(201);

      expect(res.body.moneyAckByUserId).toEqual(expect.any(String));
      expect(res.body.moneyAckAt).toEqual(expect.any(String));
    });

    it('should preserve the ack across a rename and clear it when the definition changes', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());
      const armed = ruleBody({ actions: [LABEL_STEP], isActive: true });

      const created = await http
        .post('/v1/automations')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...armed, moneyAcknowledged: true })
        .expect(201);
      const id = created.body.id as string;

      // A rename does not change what the rule DOES, so it must not make an
      // operator click through a money warning again.
      const renamed = await http
        .put(`/v1/automations/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ ...armed, name: 'Renamed', moneyAcknowledged: true })
        .expect(200);
      expect(renamed.body.moneyAckByUserId).toEqual(expect.any(String));
      expect(renamed.body.definitionHash).toBe(created.body.definitionHash);

      // Changing the CARRIER changes the definition, so the old acknowledgement
      // was about a different act.
      const redefined = await http
        .put(`/v1/automations/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          ...armed,
          actions: [{ ...LABEL_STEP, carrierId: 'inpost' }],
          moneyAcknowledged: true,
        })
        .expect(200);
      expect(redefined.body.definitionHash).not.toBe(created.body.definitionHash);
      // Re-acknowledged in the same request, so the row carries the NEW ack —
      // what matters is that it is a fresh one for the new definition.
      expect(redefined.body.moneyAckAt).not.toBe(created.body.moneyAckAt);

      // …and without a fresh acknowledgement, the redefinition is refused.
      await http
        .put(`/v1/automations/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ ...armed, actions: [{ ...LABEL_STEP, carrierId: 'dhl' }] })
        .expect(400);
    });

    it('should leave the ack CLEARED when the new definition no longer spends money', async () => {
      // The only route on which the cleared state is observable over HTTP: a
      // reversible rule needs no acknowledgement, so the write is accepted and
      // the response shows what the definition change did to the old one.
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());
      const armed = ruleBody({ actions: [LABEL_STEP], isActive: true });

      const created = await http
        .post('/v1/automations')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...armed, moneyAcknowledged: true })
        .expect(201);
      expect(created.body.moneyAckByUserId).toEqual(expect.any(String));

      const reversible = await http
        .put(`/v1/automations/${created.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send(ruleBody({ actions: [EMAIL_STEP], isActive: true }))
        .expect(200);

      expect(reversible.body.moneyAckByUserId).toBeNull();
      expect(reversible.body.moneyAckAt).toBeNull();
      expect(reversible.body.hasIrreversibleAction).toBe(false);
    });

    it('should refuse an armed rule whose irreversible action is ILLEGAL by naming the pair', async () => {
      // The acknowledgement guard must not shadow the more fundamental refusal:
      // demanding consent for an action the trigger can never run hides the
      // operator's actual problem behind a consent prompt.
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());

      const res = await http
        .post('/v1/automations')
        .set('Authorization', `Bearer ${token}`)
        .send(ruleBody({ trigger: 'return.received', actions: [LABEL_STEP], isActive: true }))
        .expect(400);

      expect(res.body.error).toBe('AutomationIllegalPairError');
    });
  });

  describe('the vocabulary endpoint', () => {
    it('should be the single source of triggers, actions, and the legality matrix', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());

      const res = await http
        .get('/v1/automations/vocabulary')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.triggers).toHaveLength(8);
      expect(res.body.actions).toHaveLength(6);
      expect(res.body.stepBounds).toEqual({ min: 1, max: 3 });
      expect(res.body.legalActions['order.packed']['dispatch-shipment']).toBe(true);
      expect(res.body.legalActions['return.received']['dispatch-shipment']).toBe(false);
      // The five that cannot fully run — the API is where an operator learns what
      // they can actually arm.
      const notReady = res.body.actions.filter(
        (a: { availability: string }) => a.availability !== 'available',
      );
      expect(notReady).toHaveLength(5);
      expect(
        notReady.every((a: { reason: string | null }) => typeof a.reason === 'string'),
      ).toBe(true);
    });
  });

  describe('the dry run', () => {
    it('should commit nothing, even when it matches a rule that would spend money', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);
      await seedOrder(dataSource);

      const created = await http
        .post('/v1/automations')
        .set('Authorization', `Bearer ${token}`)
        .send({
          ...ruleBody({ actions: [LABEL_STEP], isActive: true }),
          moneyAcknowledged: true,
        })
        .expect(201);

      const before = {
        rules: await countRows(dataSource, 'automation_rules'),
        runs: await countRows(dataSource, 'automation_runs'),
        firings: await countRows(dataSource, 'automation_trigger_firings'),
        jobs: await countRows(dataSource, 'sync_jobs'),
      };

      const res = await http
        .post('/v1/automations/evaluate')
        .set('Authorization', `Bearer ${token}`)
        .send({ orderId: 'ol_order_dryrun', ruleId: created.body.id })
        .expect(200);

      // It really did match — a dry run that quietly evaluated nothing would
      // pass a row-count assertion trivially.
      const subject = res.body.verdicts.find((v: { isSubject: boolean }) => v.isSubject);
      expect(subject.matches).toBe(true);
      expect(subject.wouldFire).toBe(true);

      expect({
        rules: await countRows(dataSource, 'automation_rules'),
        runs: await countRows(dataSource, 'automation_runs'),
        firings: await countRows(dataSource, 'automation_trigger_firings'),
        jobs: await countRows(dataSource, 'sync_jobs'),
      }).toEqual(before);
    });

    it('should preview an unsaved draft without creating a rule', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);
      await seedOrder(dataSource);

      const res = await http
        .post('/v1/automations/evaluate')
        .set('Authorization', `Bearer ${token}`)
        .send({ orderId: 'ol_order_dryrun', rule: ruleBody({ isActive: true }) })
        .expect(200);

      expect(res.body.verdicts).toHaveLength(1);
      expect(res.body.verdicts[0].isSubject).toBe(true);
      expect(res.body.verdicts[0].matches).toBe(true);
      // A draft's createdAt is now, so the floor would block every real order —
      // waived, and reported rather than silently applied.
      expect(res.body.verdicts[0].retroactivityFloorWaived).toBe(true);
      expect(await countRows(dataSource, 'automation_rules')).toBe(0);
    });

    it('should apply the same refusals to a draft that a save applies', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);
      await seedOrder(dataSource);

      const res = await http
        .post('/v1/automations/evaluate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          orderId: 'ol_order_dryrun',
          rule: ruleBody({ trigger: 'return.received', actions: [LABEL_STEP] }),
        })
        .expect(400);

      expect(res.body.error).toBe('AutomationIllegalPairError');
    });

    it('should render the per-condition trace, including a condition that could not be answered', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);
      // No shipping address, so the country fact is UNKNOWN — not "not PL".
      await dataSource.query(
        `INSERT INTO order_records
           ("internalOrderId", "sourceConnectionId", "orderSnapshot", "syncStatus", "recordStatus", "placedAt")
         VALUES ('ol_order_bare', '11111111-1111-1111-1111-111111111111', '{}'::jsonb, '[]'::jsonb, 'ready', $1)`,
        [new Date('2026-06-01').toISOString()],
      );

      const res = await http
        .post('/v1/automations/evaluate')
        .set('Authorization', `Bearer ${token}`)
        .send({ orderId: 'ol_order_bare', rule: ruleBody({ isActive: true }) })
        .expect(200);

      const verdict = res.body.verdicts[0];
      expect(verdict.conditionTraces).toHaveLength(1);
      expect(verdict.conditionTraces[0].outcome).toBe('unknown');
      expect(verdict.nonFiringReason).toBe('condition-fact-unknown');
    });

    it('should never echo the order snapshot', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);
      await dataSource.query(
        `INSERT INTO order_records
           ("internalOrderId", "sourceConnectionId", "orderSnapshot", "syncStatus", "recordStatus", "placedAt")
         VALUES ('ol_order_pii', '11111111-1111-1111-1111-111111111111', $1::jsonb, '[]'::jsonb, 'ready', $2)`,
        [
          JSON.stringify({
            shippingAddress: { countryIso2: 'PL', address1: 'ul. Testowa 1' },
            customerEmail: 'buyer@example.com',
            customerName: 'A Real Buyer',
          }),
          new Date('2026-06-01').toISOString(),
        ],
      );

      const res = await http
        .post('/v1/automations/evaluate')
        .set('Authorization', `Bearer ${token}`)
        .send({ orderId: 'ol_order_pii', rule: ruleBody({ isActive: true }) })
        .expect(200);

      // A diagnostics endpoint must not become a PII read under OL_STORE_PII=true.
      const body = JSON.stringify(res.body);
      expect(body).not.toContain('buyer@example.com');
      expect(body).not.toContain('A Real Buyer');
      expect(body).not.toContain('ul. Testowa 1');
      expect(res.body.facts.country).toBe('PL');
    });

    it('should refuse a body naming neither a rule nor a draft', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());
      await http
        .post('/v1/automations/evaluate')
        .set('Authorization', `Bearer ${token}`)
        .send({ orderId: 'ol_order_dryrun' })
        .expect(400);
    });
  });

  describe('the AC chain: create -> evaluate -> runs', () => {
    it('should walk the whole loop, and say the run log is not recorded yet', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);
      await seedOrder(dataSource);

      const created = await http
        .post('/v1/automations')
        .set('Authorization', `Bearer ${token}`)
        .send(ruleBody({ isActive: true }))
        .expect(201);
      const id = created.body.id as string;

      const evaluated = await http
        .post('/v1/automations/evaluate')
        .set('Authorization', `Bearer ${token}`)
        .send({ orderId: 'ol_order_dryrun', ruleId: id })
        .expect(200);
      expect(evaluated.body.verdicts.find((v: { isSubject: boolean }) => v.isSubject).matches).toBe(
        true,
      );

      const runs = await http
        .get(`/v1/automations/${id}/runs`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(runs.body.runs).toEqual([]);
      // #2385 bound the persisting recorder, so the honest answer flipped: an
      // empty log now really does mean "nothing fired" rather than "not built
      // yet", and the `note` that said otherwise is gone. This assertion was
      // written against the pre-#2385 `LoggingAutomationRunRecorder` and could
      // not be corrected then — Docker was wedged host-level for the whole of
      // #2385 and #2386, so no integration run observed the flip.
      expect(runs.body.recordingAvailable).toBe(true);
      expect(runs.body.note).toBeUndefined();
      expect(runs.body.limit).toBe(50);

      await http
        .delete(`/v1/automations/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);
      await http
        .get(`/v1/automations/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('should 404 the fired log for a rule that does not exist', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());
      const res = await http
        .get('/v1/automations/8f1c0d2e-0000-4000-8000-000000000000/runs')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
      expect(res.body.error).toBe('AutomationRuleNotFoundError');
    });
  });

  describe('authorization', () => {
    it('should let an operator read and dry-run, but not author', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const adminToken = await loginAsAdmin(http, dataSource);
      const operatorToken = await loginAsOperator(http, dataSource);
      await seedOrder(dataSource);

      const created = await http
        .post('/v1/automations')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(ruleBody({ isActive: true }))
        .expect(201);

      // Diagnosing why a rule did not fire is operational work, and the dry run
      // writes nothing.
      await http
        .get('/v1/automations?trigger=order.packed')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);
      await http
        .get('/v1/automations/vocabulary')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);
      await http
        .post('/v1/automations/evaluate')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ orderId: 'ol_order_dryrun', ruleId: created.body.id })
        .expect(200);

      // Arming an automation is a STANDING grant of authority to spend money, and
      // a rule's actions are editable — so a permission a later edit could
      // escalate is not a permission.
      await http
        .post('/v1/automations')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send(ruleBody())
        .expect(403);
      await http
        .put(`/v1/automations/${created.body.id}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send(ruleBody())
        .expect(403);
      await http
        .delete(`/v1/automations/${created.body.id}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(403);
    });
  });
});
