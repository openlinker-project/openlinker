/**
 * Regulatory Status Reconcile worker-module DI smoke test (#1121)
 *
 * Boots the worker DI graph and asserts `RegulatoryStatusReconcileHandler`
 * resolves — i.e. `SyncWorkerModule` imports `InvoicingModule` and the
 * `REGULATORY_STATUS_RECONCILIATION_SERVICE_TOKEN` is EXPORTED from
 * `InvoicingModule` (a missing export would fail the worker's DI at boot,
 * decision #12). Also asserts the handler is registered for the
 * `invoicing.regulatoryStatus.reconcile` job type.
 *
 * @module apps/worker/test/integration
 */
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { WorkerIntegrationTestHarness } from './setup';
import { RegulatoryStatusReconcileHandler } from '../../src/sync/handlers/regulatory-status-reconcile.handler';
import { SyncJobHandlerRegistry } from '../../src/sync/handlers/sync-job-handler.registry';

describe('regulatory-status reconcile worker DI (integration)', () => {
  let harness: WorkerIntegrationTestHarness;

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('RegulatoryStatusReconcileHandler resolves from the worker DI graph', () => {
    // A missing InvoicingModule import / un-exported reconciliation-service
    // token would have failed the app boot in beforeAll; reaching here AND
    // resolving the handler instance proves the graph wired up.
    const handler = harness.get(RegulatoryStatusReconcileHandler);
    expect(handler).toBeInstanceOf(RegulatoryStatusReconcileHandler);
  });

  it('the handler is registered for jobType invoicing.regulatoryStatus.reconcile', () => {
    const registry = harness.get(SyncJobHandlerRegistry);
    const handler = registry.getHandler('invoicing.regulatoryStatus.reconcile');

    expect(handler).not.toBeNull();
    expect(handler).toBeInstanceOf(RegulatoryStatusReconcileHandler);
  });
});
