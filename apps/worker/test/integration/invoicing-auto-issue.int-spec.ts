/**
 * Invoicing Auto-Issue — End-to-End Integration Test (OL #1120).
 *
 * Drives the core policy composer (`AutoIssueTriggerService.onOrderTransition` —
 * the ADR-007 sync-orchestration seam reached from OrderIngestionService) against
 * the REAL Postgres-backed `ConnectionPort` and `SyncJobsService`, so the
 * per-connection trigger model and the deterministic-key exactly-once gate are
 * exercised against real persistence (not mocks). Seeds an Invoicing connection
 * per trigger model and asserts the `invoicing.issue` jobs the transition does
 * (or does not) enqueue.
 *
 * The full ingestion → adapter → InvoiceRecord path needs a per-connection
 * 'Invoicing' provider adapter wired through the integrations registry; that is
 * covered at unit level (invoice.service.spec / invoicing-issue.handler.spec).
 * Here we assert the enqueue contract and the DB-backed idempotency end-to-end.
 *
 * @module apps/worker/test/integration
 */
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { WorkerIntegrationTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';
import { getAllSyncJobs } from './helpers/test-sync-job.helper';
import {
  AUTO_ISSUE_TRIGGER_SERVICE_TOKEN,
  type IAutoIssueTriggerService,
} from '@openlinker/core/invoicing';
import type { Order } from '@openlinker/core/orders';
import type { InvoiceTriggerModel } from '@openlinker/core/invoicing';
import {
  SALES_DOCUMENT_RULES_SERVICE_TOKEN,
  type ISalesDocumentRulesService,
} from '@openlinker/core/sales-documents';

/** Build a clean unified Order fixture (mirrors the unit-suite shape). */
function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-int-1',
    orderNumber: 'OL-1',
    status: 'processing',
    paymentStatus: 'awaiting',
    items: [{ id: 'i1', productId: 'p1', quantity: 2, price: 10, name: 'Widget' }],
    totals: {
      subtotal: 20,
      tax: 0,
      shipping: 0,
      total: 20,
      currency: 'PLN',
      taxTreatment: 'inclusive',
    },
    billingAddress: {
      firstName: 'Jan',
      lastName: 'Kowalski',
      address1: 'ul. Testowa 1',
      city: 'Poznań',
      postalCode: '60-001',
      country: 'PL',
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Order;
}

/**
 * `makeOrder()` plus a delivery (shipping) address — the one fact the #2173
 * order-facts mapper needs to build a non-null projection and reach the rule
 * engine at all. Every pre-#2173 fixture in this file uses `makeOrder()`
 * (billing address only), which keeps the rule engine out of the loop
 * entirely — this helper is for the new rule-engine-wiring tests below.
 */
function makeOrderWithDelivery(country: string, overrides: Partial<Order> = {}): Order {
  return makeOrder({
    shippingAddress: {
      firstName: 'Jan',
      lastName: 'Kowalski',
      address1: 'ul. Testowa 1',
      city: 'Poznań',
      postalCode: '60-001',
      country,
    },
    ...overrides,
  });
}

/**
 * Seed an ACTIVE connection that declares the Invoicing capability + trigger
 * model. `config.salesDocument.documentKind: 'invoice'` is what makes the
 * connection an ELIGIBLE `resolveSalesDocumentRouting` candidate at all post-
 * #2155/#2156 (`readSalesDocumentRouting` reads that key, not the bare
 * capability) — without it every seeded connection has zero eligible
 * candidates and `AutoIssueTriggerService` short-circuits to `none` before
 * ever reaching a resolver.
 */
async function seedInvoicingConnection(
  harness: WorkerIntegrationTestHarness,
  triggerModel: InvoiceTriggerModel,
  options: { isPrimary?: boolean } = {},
): Promise<string> {
  const conn = await createTestConnection(harness.getDataSource(), {
    platformType: 'subiekt',
    name: `Invoicing (${triggerModel})`,
    status: 'active',
    // The real registered adapterKey (`subiektAdapterManifest.adapterKey`) is
    // `'subiekt.invoicing.v1'`, not `'subiekt.bridge.v1'` — the decision-7
    // deeper capability check (#2156) resolves this key against the REAL
    // adapter factory registry, so a wrong key here fails closed with
    // `AdapterNotFoundException` and every positive test in this file silently
    // enqueues zero jobs.
    adapterKey: 'subiekt.invoicing.v1',
    // The Subiekt bridge token is OPTIONAL and only resolved when
    // `credentialsRef` is truthy (`SubiektAdapterFactory.createAdapters`) —
    // `createTestConnection`'s default `'test-credentials-ref'` does not
    // resolve against the real encrypted-credentials store, so decision-7's
    // deeper capability check would otherwise fail on a generic lookup error.
    // Falsy (not just non-resolvable) — `SubiektAdapterFactory.createAdapters`
    // only resolves credentials when `credentialsRef` is truthy, and the
    // column is NOT NULL so `''` (not `undefined`/`null`) is required here.
    credentialsRef: '',
    // #2047: `isPrimary` resolves WHICH connection auto-issues once several are
    // eligible; a single-connection install ignores it entirely.
    // `bridgeBaseUrl` is required for `SubiektAdapterFactory` to construct the
    // real adapter at all (decision-7's deeper capability check resolves it) —
    // never dialed in these tests, only used to pass config validation.
    config: {
      bridgeBaseUrl: 'http://localhost:9999',
      invoicing: { triggerModel, ...(options.isPrimary === true ? { isPrimary: true } : {}) },
      salesDocument: { documentKind: 'invoice' },
    },
    enabledCapabilities: ['Invoicing'],
  });
  return conn.id;
}

/** All invoicing.issue jobs currently in the DB (newest first). */
async function invoicingJobs(harness: WorkerIntegrationTestHarness) {
  const all = await getAllSyncJobs(harness.getDataSource());
  return all.filter((j) => j.jobType === 'invoicing.issue');
}

describe('Invoicing Auto-Issue Integration (OL #1120)', () => {
  let harness: WorkerIntegrationTestHarness;
  let trigger: IAutoIssueTriggerService;
  let salesDocumentRules: ISalesDocumentRulesService;

  beforeAll(async () => {
    harness = await getTestHarness();
    trigger = harness.get<IAutoIssueTriggerService>(AUTO_ISSUE_TRIGGER_SERVICE_TOKEN);
    salesDocumentRules = harness.get<ISalesDocumentRulesService>(
      SALES_DOCUMENT_RULES_SERVICE_TOKEN,
    );
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  describe('auto-on-paid', () => {
    it('a paid order transition enqueues exactly one invoicing.issue job with the deterministic key', async () => {
      const connId = await seedInvoicingConnection(harness, 'auto-on-paid');
      await salesDocumentRules.upsertCountryDefault({
        country: 'DE',
        documentKind: 'invoice',
        connectionId: connId,
      });
      const order = makeOrderWithDelivery('DE', { id: 'order-paid-1', paymentStatus: 'paid' });

      await trigger.onOrderTransition(order, 'src-conn-1', 'evt-1');

      const jobs = await invoicingJobs(harness);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].connectionId).toBe(connId);
      // F4: deterministic key `invoice:{connId}:{orderId}`, threaded into the row
      // AND the payload.
      expect(jobs[0].idempotencyKey).toBe(`invoice:${connId}:order-paid-1`);
      expect((jobs[0].payloadJson as { idempotencyKey: string }).idempotencyKey).toBe(
        `invoice:${connId}:order-paid-1`,
      );
    });

    it('a re-delivered paid event produces NO second job (D7 — deterministic-key short-circuit)', async () => {
      const connId = await seedInvoicingConnection(harness, 'auto-on-paid');
      await salesDocumentRules.upsertCountryDefault({
        country: 'DE',
        documentKind: 'invoice',
        connectionId: connId,
      });
      const order = makeOrderWithDelivery('DE', {
        id: 'order-paid-dupe',
        paymentStatus: 'paid',
      });

      // First delivery enqueues.
      await trigger.onOrderTransition(order, 'src-conn-1', 'evt-1');
      // Re-delivery of the SAME order/connection: same deterministic key →
      // SyncJobsService.schedule is a no-op against the existing row.
      await trigger.onOrderTransition(order, 'src-conn-1', 'evt-1-redeliver');

      const jobs = await invoicingJobs(harness);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].idempotencyKey).toBe(`invoice:${connId}:order-paid-dupe`);
    });

    it('a non-paid order on an auto-on-paid connection enqueues nothing', async () => {
      const connId = await seedInvoicingConnection(harness, 'auto-on-paid');
      await salesDocumentRules.upsertCountryDefault({
        country: 'DE',
        documentKind: 'invoice',
        connectionId: connId,
      });
      await trigger.onOrderTransition(
        makeOrderWithDelivery('DE', { id: 'order-awaiting', paymentStatus: 'awaiting' }),
        'src-conn-1',
      );
      expect(await invoicingJobs(harness)).toHaveLength(0);
    });
  });

  describe('auto-on-shipped', () => {
    it('a shipped order transition enqueues exactly one invoicing.issue job', async () => {
      const connId = await seedInvoicingConnection(harness, 'auto-on-shipped');
      await salesDocumentRules.upsertCountryDefault({
        country: 'DE',
        documentKind: 'invoice',
        connectionId: connId,
      });
      await trigger.onOrderTransition(
        makeOrderWithDelivery('DE', { id: 'order-shipped', status: 'shipped' }),
        'src-conn-1',
      );
      const jobs = await invoicingJobs(harness);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].connectionId).toBe(connId);
      expect(jobs[0].idempotencyKey).toBe(`invoice:${connId}:order-shipped`);
    });

    it('a non-shipped order on an auto-on-shipped connection enqueues nothing', async () => {
      const connId = await seedInvoicingConnection(harness, 'auto-on-shipped');
      await salesDocumentRules.upsertCountryDefault({
        country: 'DE',
        documentKind: 'invoice',
        connectionId: connId,
      });
      await trigger.onOrderTransition(
        makeOrderWithDelivery('DE', {
          id: 'order-proc',
          status: 'processing',
          paymentStatus: 'paid',
        }),
        'src-conn-1',
      );
      expect(await invoicingJobs(harness)).toHaveLength(0);
    });
  });

  describe('manual', () => {
    it('a manual connection produces ZERO invoicing.issue jobs even for a paid+shipped order that routes to it', async () => {
      const connId = await seedInvoicingConnection(harness, 'manual');
      // Routing resolves the connection unambiguously (a country default
      // names exactly one connectionId in the #2170 model — there is no
      // sibling-candidate ambiguity to introduce here); the trigger-model
      // gate, checked AFTER routing resolves a winner, is what this test
      // exercises.
      await salesDocumentRules.upsertCountryDefault({
        country: 'DE',
        documentKind: 'invoice',
        connectionId: connId,
      });
      await trigger.onOrderTransition(
        makeOrderWithDelivery('DE', {
          id: 'order-manual',
          status: 'shipped',
          paymentStatus: 'paid',
        }),
        'src-conn-1',
      );
      expect(await invoicingJobs(harness)).toHaveLength(0);
    });
  });

  // #2047: one sale is one invoice. Since the retirement of the
  // operator-configured `isPrimary` fallback ("opcja b" — see
  // `chooseSalesDocumentDecision`'s own doc comment), this is now enforced
  // STRUCTURALLY rather than by a runtime tie-break: a country default /
  // rule names exactly ONE connectionId, so there is no ambiguous-candidate
  // set for a "primary" to disambiguate anymore. These tests assert that a
  // sibling connection which is otherwise eligible (right capability, right
  // trigger model) but NOT the one the rule engine named never receives a
  // job — the same "exactly one document" invariant, produced the new way.
  describe('exactly one originating document per order (#2047, post-fallback-retirement)', () => {
    it('only the connection the rule engine names enqueues, even when an equally-eligible sibling exists', async () => {
      const named = await seedInvoicingConnection(harness, 'auto-on-paid');
      // A second connection whose trigger model ALSO matches a paid order,
      // but which the rule engine never names for this country.
      await seedInvoicingConnection(harness, 'auto-on-paid');
      await seedInvoicingConnection(harness, 'manual');
      await salesDocumentRules.upsertCountryDefault({
        country: 'DE',
        documentKind: 'invoice',
        connectionId: named,
      });

      await trigger.onOrderTransition(
        makeOrderWithDelivery('DE', {
          id: 'order-mixed',
          status: 'processing',
          paymentStatus: 'paid',
        }),
        'src-conn-1',
      );

      const jobs = await invoicingJobs(harness);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].connectionId).toBe(named);
      expect(jobs[0].idempotencyKey).toBe(`invoice:${named}:order-mixed`);
    });

    it('several eligible connections enqueue NOTHING when the rule engine has no configuration at all for the order country', async () => {
      await seedInvoicingConnection(harness, 'auto-on-paid');
      await seedInvoicingConnection(harness, 'auto-on-shipped');

      await trigger.onOrderTransition(
        makeOrderWithDelivery('PL', {
          id: 'order-ambiguous',
          status: 'processing',
          paymentStatus: 'paid',
        }),
        'src-conn-1',
      );

      expect(await invoicingJobs(harness)).toHaveLength(0);
    });

    it('a country default naming a manual connection issues nothing, even with an eligible auto-on-paid sibling present', async () => {
      const manualConn = await seedInvoicingConnection(harness, 'manual');
      await seedInvoicingConnection(harness, 'auto-on-paid');
      await salesDocumentRules.upsertCountryDefault({
        country: 'DE',
        documentKind: 'invoice',
        connectionId: manualConn,
      });

      await trigger.onOrderTransition(
        makeOrderWithDelivery('DE', {
          id: 'order-manual-primary',
          status: 'processing',
          paymentStatus: 'paid',
        }),
        'src-conn-1',
      );

      expect(await invoicingJobs(harness)).toHaveLength(0);
    });
  });

  // #2173: `AutoIssueTriggerService` now consults the country-agnostic rule
  // engine (#2170) BEFORE the single-primary resolver, against the REAL
  // Postgres-backed `SalesDocumentRulesService` (not a mock) — complementing
  // the mocked-rule-engine unit tests in `auto-issue-trigger.service.spec.ts`.
  // `sales_document_rules` / `sales_document_country_defaults` cascade-delete
  // with their referenced connection (migration FK, `ON DELETE CASCADE`), so
  // `resetTestHarness()`'s `TRUNCATE TABLE connections CASCADE` also clears
  // them between tests — no manual cleanup needed.
  describe('rule-engine-first routing (#2173)', () => {
    it("an order whose country has a configured country default (no rules, no tax-id condition) routes to that default's connection/kind", async () => {
      const connId = await seedInvoicingConnection(harness, 'auto-on-paid');
      await salesDocumentRules.upsertCountryDefault({
        country: 'DE',
        documentKind: 'invoice',
        connectionId: connId,
      });

      const order = makeOrderWithDelivery('DE', {
        id: 'order-de-country-default',
        paymentStatus: 'paid',
      });
      await trigger.onOrderTransition(order, 'src-conn-1', 'evt-1');

      const jobs = await invoicingJobs(harness);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].connectionId).toBe(connId);
      expect(jobs[0].idempotencyKey).toBe(`invoice:${connId}:order-de-country-default`);
    });

    it('an order whose country has NO rule-engine configuration at all enqueues NOTHING — the single-primary isPrimary fallback is retired', async () => {
      // No `sales_document_rules` / `sales_document_country_defaults` row
      // exists for 'PL' at all (only the unrelated seeded
      // `pl-simplified-invoice-2026` threshold row, which no rule references
      // here) — this IS what "an untouched install" means. Pre-#2170 this
      // fell back to `isPrimary` selection; that fallback is retired
      // ("opcja b"), so `chooseSalesDocumentDecision` returns `null` here
      // and `onOrderTransition` enqueues nothing — even with a single,
      // unambiguous `auto-on-paid` connection present.
      await seedInvoicingConnection(harness, 'auto-on-paid');
      const order = makeOrderWithDelivery('PL', {
        id: 'order-pl-legacy-fallback',
        paymentStatus: 'paid',
      });

      await trigger.onOrderTransition(order, 'src-conn-1', 'evt-1');

      expect(await invoicingJobs(harness)).toHaveLength(0);
    });

    it('several eligible operator-configured connections with no primary still enqueue NOTHING when the rule engine has no configuration for the order country (#2047 regression)', async () => {
      await seedInvoicingConnection(harness, 'auto-on-paid');
      await seedInvoicingConnection(harness, 'auto-on-paid');

      const order = makeOrderWithDelivery('PL', {
        id: 'order-pl-ambiguous-fallback',
        paymentStatus: 'paid',
      });
      await trigger.onOrderTransition(order, 'src-conn-1', 'evt-1');

      expect(await invoicingJobs(harness)).toHaveLength(0);
    });
  });
});
