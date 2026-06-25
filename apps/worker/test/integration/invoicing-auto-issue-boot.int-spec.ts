/**
 * Invoicing Auto-Issue — DI Boot / Container Integration Test (OL #1120).
 *
 * HARD GATE (F2/F3): boots the real Nest container (the worker AppModule, which
 * imports SyncWorkerModule) and resolves BOTH `InvoicingIssueHandler` AND
 * `OrderIngestionService`. The latter proves `OrdersModule → InvoicingModule`
 * exports `AUTO_ISSUE_TRIGGER_SERVICE_TOKEN` at runtime and that no DI / barrel
 * cycle exists (the first runtime value edge invoicing → orders, via
 * `auto-issue-trigger.service.ts`). Unit suites cannot catch a missing export,
 * unexported token, unprovided handler, or circular module dep — this is the only
 * automated guard against that class of bug.
 *
 * @module apps/worker/test/integration
 */
import { getTestHarness, teardownTestHarness } from './setup';
import type { WorkerIntegrationTestHarness } from './setup';
import { ORDER_INGESTION_SERVICE_TOKEN } from '@openlinker/core/orders';
import { AUTO_ISSUE_TRIGGER_SERVICE_TOKEN } from '@openlinker/core/invoicing';
import { InvoicingIssueHandler } from '../../src/sync/handlers/invoicing-issue.handler';
import { SyncJobHandlerRegistry } from '../../src/sync/handlers/sync-job-handler.registry';

describe('Invoicing Auto-Issue — DI boot (HARD GATE, OL #1120)', () => {
  let harness: WorkerIntegrationTestHarness;

  beforeAll(async () => {
    // Booting the harness boots the real AppModule container. If OrdersModule ⇄
    // InvoicingModule formed a DI/barrel cycle, or AUTO_ISSUE_TRIGGER_SERVICE_TOKEN
    // were not exported, or InvoicingIssueHandler were unprovided, this would throw.
    harness = await getTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('the real container resolves InvoicingIssueHandler', () => {
    const handler = harness.get(InvoicingIssueHandler);
    expect(handler).toBeInstanceOf(InvoicingIssueHandler);
  });

  it('the real container resolves OrderIngestionService (AUTO_ISSUE_TRIGGER_SERVICE_TOKEN resolves; no DI cycle)', () => {
    // Resolving OrderIngestionService forces the AUTO_ISSUE_TRIGGER_SERVICE_TOKEN
    // injection (its 11th constructor dep) to resolve from InvoicingModule's export.
    const ingestion = harness.get(ORDER_INGESTION_SERVICE_TOKEN);
    expect(ingestion).toBeDefined();

    // And the token itself resolves to the trigger service the ingestion service injects.
    const trigger = harness.get(AUTO_ISSUE_TRIGGER_SERVICE_TOKEN);
    expect(trigger).toBeDefined();
    expect(typeof (trigger as { onOrderTransition?: unknown }).onOrderTransition).toBe('function');
  });

  it('invoicing.issue is registered in the handler registry after onModuleInit', () => {
    // HandlerRegistrationService.onModuleInit runs during container boot; assert
    // the invoicing.issue job type is wired to a handler in the live registry.
    const registry = harness.get(SyncJobHandlerRegistry);
    expect(registry.getRegisteredJobTypes()).toContain('invoicing.issue');
    expect(registry.getHandler('invoicing.issue')).toBeInstanceOf(InvoicingIssueHandler);
  });
});
