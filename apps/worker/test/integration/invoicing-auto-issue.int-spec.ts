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

/** Seed an ACTIVE connection that declares the Invoicing capability + trigger model. */
async function seedInvoicingConnection(
  harness: WorkerIntegrationTestHarness,
  triggerModel: InvoiceTriggerModel,
): Promise<string> {
  const conn = await createTestConnection(harness.getDataSource(), {
    platformType: 'subiekt',
    name: `Invoicing (${triggerModel})`,
    status: 'active',
    adapterKey: 'subiekt.bridge.v1',
    config: { invoicing: { triggerModel } },
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

  beforeAll(async () => {
    harness = await getTestHarness();
    trigger = harness.get<IAutoIssueTriggerService>(AUTO_ISSUE_TRIGGER_SERVICE_TOKEN);
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
      const order = makeOrder({ id: 'order-paid-1', paymentStatus: 'paid' });

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
      const order = makeOrder({ id: 'order-paid-dupe', paymentStatus: 'paid' });

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
      await seedInvoicingConnection(harness, 'auto-on-paid');
      await trigger.onOrderTransition(
        makeOrder({ id: 'order-awaiting', paymentStatus: 'awaiting' }),
        'src-conn-1',
      );
      expect(await invoicingJobs(harness)).toHaveLength(0);
    });
  });

  describe('auto-on-shipped', () => {
    it('a shipped order transition enqueues exactly one invoicing.issue job', async () => {
      const connId = await seedInvoicingConnection(harness, 'auto-on-shipped');
      await trigger.onOrderTransition(
        makeOrder({ id: 'order-shipped', status: 'shipped' }),
        'src-conn-1',
      );
      const jobs = await invoicingJobs(harness);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].connectionId).toBe(connId);
      expect(jobs[0].idempotencyKey).toBe(`invoice:${connId}:order-shipped`);
    });

    it('a non-shipped order on an auto-on-shipped connection enqueues nothing', async () => {
      await seedInvoicingConnection(harness, 'auto-on-shipped');
      await trigger.onOrderTransition(
        makeOrder({ id: 'order-proc', status: 'processing', paymentStatus: 'paid' }),
        'src-conn-1',
      );
      expect(await invoicingJobs(harness)).toHaveLength(0);
    });
  });

  describe('manual', () => {
    it('a manual connection produces ZERO invoicing.issue jobs even for a paid+shipped order', async () => {
      await seedInvoicingConnection(harness, 'manual');
      await trigger.onOrderTransition(
        makeOrder({ id: 'order-manual', status: 'shipped', paymentStatus: 'paid' }),
        'src-conn-1',
      );
      expect(await invoicingJobs(harness)).toHaveLength(0);
    });
  });

  describe('per-connection isolation', () => {
    it('only the connections whose trigger model matches enqueue (manual + auto-on-shipped present, order is paid only)', async () => {
      const autoPaid = await seedInvoicingConnection(harness, 'auto-on-paid');
      await seedInvoicingConnection(harness, 'auto-on-shipped');
      await seedInvoicingConnection(harness, 'manual');

      await trigger.onOrderTransition(
        makeOrder({ id: 'order-mixed', status: 'processing', paymentStatus: 'paid' }),
        'src-conn-1',
      );

      const jobs = await invoicingJobs(harness);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].connectionId).toBe(autoPaid);
    });
  });
});
