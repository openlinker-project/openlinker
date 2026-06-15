/**
 * DPD Polska Scheduler Tasks
 *
 * Builds the `SchedulerTaskConfig` instances the DPD plugin contributes to the
 * core `SchedulerTaskRegistryService`. One task (#965):
 *
 *   - `dpd-shipment-status-sync` — drives the carrier-generic
 *     `marketplace.shipment.statusSync` job (#838) for DPD connections. The
 *     worker handler re-reads each non-terminal DPD `Shipment` via `getTracking`
 *     (SOAP DPDInfoServices, ADR-022), advances OL's row toward carrier reality,
 *     and propagates status + tracking to the destination OMP. DPD has **no
 *     tracking webhook**, so this poll is the *only* tracking path (not a
 *     fallback). Per-waybill fan-out → keep the cadence conservative (default
 *     30 min) and the page limit modest. Rolling scan-offset cursor key
 *     `dpd.shipmentStatus.scanOffset` (disjoint from Allegro/InPost).
 *
 * **Why `process.env` (not `ConfigService`):** identical rationale to the InPost
 * tasks — the plugin is constructed eagerly by `createNestAdapterModule` and
 * this builder runs from the descriptor's `register(host)` at `onModuleInit`,
 * after the host has populated `process.env`. The core scheduler re-reads
 * `enabledEnvVar` each tick for runtime on/off toggling.
 *
 * @module libs/integrations/dpd-polska/src/infrastructure/scheduler
 * @see {@link SchedulerTaskConfig} in `@openlinker/core/sync`.
 */
import type {
  MarketplaceShipmentStatusSyncPayloadV1,
  SchedulerTaskConfig,
} from '@openlinker/core/sync';

const SCHEDULER_ENABLED_ENV = 'OL_DPD_SHIPMENT_STATUS_SYNC_SCHEDULER_ENABLED';
const INTERVAL_CRON_ENV = 'OL_DPD_SHIPMENT_STATUS_SYNC_INTERVAL_CRON';
const PAGE_LIMIT_ENV = 'OL_DPD_SHIPMENT_STATUS_SYNC_PAGE_LIMIT';

/** Every 30 min (6-field, seconds-leading — parity with InPost/Allegro tasks). */
const DEFAULT_INTERVAL_CRON = '0 */30 * * * *';
const DEFAULT_PAGE_LIMIT = 50;

/** Disjoint from Allegro's / InPost's shipment-status cursors. */
const CURSOR_KEY = 'dpd.shipmentStatus.scanOffset';

const isEnabled = (key: string): boolean => (process.env[key] ?? 'true') !== 'false';

function resolvePageLimit(): number {
  const raw = process.env[PAGE_LIMIT_ENV];
  const parsed = raw !== undefined && raw !== '' ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : DEFAULT_PAGE_LIMIT;
}

/**
 * Build the DPD scheduler-task list. Returns 0–1 tasks depending on the
 * `OL_DPD_SHIPMENT_STATUS_SYNC_SCHEDULER_ENABLED` gate.
 */
export function buildDpdSchedulerTasks(): SchedulerTaskConfig[] {
  const tasks: SchedulerTaskConfig[] = [];

  if (isEnabled(SCHEDULER_ENABLED_ENV)) {
    const cronExpression = process.env[INTERVAL_CRON_ENV] || DEFAULT_INTERVAL_CRON;
    const pageLimit = resolvePageLimit();

    tasks.push({
      taskId: 'dpd-shipment-status-sync',
      platformType: 'dpd',
      jobType: 'marketplace.shipment.statusSync',
      cronExpression,
      enabledEnvVar: SCHEDULER_ENABLED_ENV,
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
