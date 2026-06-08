/**
 * InPost Scheduler Tasks
 *
 * Builds the `SchedulerTaskConfig` instances InPost contributes to the core
 * `SchedulerTaskRegistryService`. One task today:
 *
 *   - `inpost-shipment-status-sync` (#772) — the webhook **fallback** for InPost
 *     tracking. Drives the existing carrier-generic `marketplace.shipment.statusSync`
 *     job (#838) for InPost connections: the worker handler re-reads each
 *     non-terminal InPost `Shipment` via `getTracking`, advances OL's row toward
 *     carrier reality, and projects the tracking number to the destination OMP.
 *     This package adds **only the scheduling** — the poll engine, job, handler,
 *     and propagation path are all #838. Rolling scan-offset cursor key
 *     `inpost.shipmentStatus.scanOffset` (disjoint from Allegro's). Default every
 *     30 minutes — deliberately slower than Allegro's 15 because this is a
 *     fallback for when the InPost webhook (#768) isn't provisioned, not the
 *     primary path.
 *
 * **Why `process.env` (not `ConfigService`):** the InPost plugin is constructed
 * eagerly by `createNestAdapterModule` (no DI container at construction), and
 * this builder is invoked from the descriptor's `register(host)` at
 * `onModuleInit` — after the host bootstrap has populated `process.env` (incl.
 * dotenv). Reading `process.env` here is correct and intentional; do NOT "fix"
 * it toward `ConfigService` (that would require converting InPost off the
 * easy-path module). Mirrors the #849 pickup-refresh precedent. The core
 * scheduler re-reads `enabledEnvVar` at each tick for runtime on/off toggling.
 *
 * @module libs/integrations/inpost/src/infrastructure/scheduler
 * @see {@link SchedulerTaskConfig} in `@openlinker/core/sync`.
 */
import type {
  MarketplaceShipmentStatusSyncPayloadV1,
  SchedulerTaskConfig,
} from '@openlinker/core/sync';

const SCHEDULER_ENABLED_ENV = 'OL_INPOST_SHIPMENT_STATUS_SYNC_SCHEDULER_ENABLED';
const INTERVAL_CRON_ENV = 'OL_INPOST_SHIPMENT_STATUS_SYNC_INTERVAL_CRON';
const PAGE_LIMIT_ENV = 'OL_INPOST_SHIPMENT_STATUS_SYNC_PAGE_LIMIT';

/** Every 30 min (6-field, seconds-leading — parity with Allegro's task). */
const DEFAULT_INTERVAL_CRON = '0 */30 * * * *';
const DEFAULT_PAGE_LIMIT = 50;

/** Disjoint from Allegro's `allegro.shipmentStatus.scanOffset`. */
const CURSOR_KEY = 'inpost.shipmentStatus.scanOffset';

const isEnabled = (key: string): boolean => (process.env[key] ?? 'true') !== 'false';

function resolvePageLimit(): number {
  const raw = process.env[PAGE_LIMIT_ENV];
  const parsed = raw !== undefined && raw !== '' ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : DEFAULT_PAGE_LIMIT;
}

/**
 * Build the InPost scheduler-task list. Returns 0–1 tasks depending on the
 * `OL_INPOST_SHIPMENT_STATUS_SYNC_SCHEDULER_ENABLED` gate.
 */
export function buildInpostSchedulerTasks(): SchedulerTaskConfig[] {
  const tasks: SchedulerTaskConfig[] = [];

  if (isEnabled(SCHEDULER_ENABLED_ENV)) {
    const cronExpression = process.env[INTERVAL_CRON_ENV] || DEFAULT_INTERVAL_CRON;
    const pageLimit = resolvePageLimit();

    tasks.push({
      taskId: 'inpost-shipment-status-sync',
      platformType: 'inpost',
      jobType: 'marketplace.shipment.statusSync',
      cronExpression,
      enabledEnvVar: SCHEDULER_ENABLED_ENV,
      // `satisfies` (not a return annotation): validates the literal against the
      // handler's payload contract at compile time while keeping the inferred type
      // assignable to SchedulerTaskConfig.generatePayload's `Record<string, unknown>`
      // (a named interface lacks the index signature that return type requires).
      generatePayload: () =>
        ({
          schemaVersion: 1,
          limit: pageLimit,
          cursorKey: CURSOR_KEY,
        }) satisfies MarketplaceShipmentStatusSyncPayloadV1,
      generateIdempotencyKey: (connection, timestamp) =>
        `marketplace:${connection.id}:shipment:status:sync:${timestamp}`,
    });
  }

  return tasks;
}
