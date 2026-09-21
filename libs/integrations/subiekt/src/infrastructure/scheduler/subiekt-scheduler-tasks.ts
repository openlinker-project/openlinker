/**
 * Subiekt Scheduler Tasks (#3358)
 *
 * Builds the `SchedulerTaskConfig` Subiekt contributes to the core
 * `SchedulerTaskRegistryService` — the reachability sweep that periodically
 * re-probes the bridge via `ConnectionTesterPort` (the same check the
 * connection-detail "Test connection" button and `/v1/health/dev-stack`
 * both use), so a dead/unreachable Sfera bridge produces at least a
 * structured, greppable log line instead of silence.
 *
 * No `requiredCapability` — every active Subiekt connection gets swept
 * regardless of which capabilities are enabled on it, since reachability is
 * a property of the bridge process, not of any one capability.
 *
 * @module libs/integrations/subiekt/src/infrastructure/scheduler
 * @see {@link SchedulerTaskConfig} in `@openlinker/core/sync`.
 */
import type { SchedulerTaskConfig } from '@openlinker/core/sync';

/** Every 5 minutes — frequent enough to bound outage-detection latency without adding meaningful load (the check itself is a single lightweight bridge HTTP call). */
const SUBIEKT_BRIDGE_REACHABILITY_SWEEP_CRON = '*/5 * * * *';

export function buildSubiektSchedulerTasks(): SchedulerTaskConfig[] {
  return [
    {
      taskId: 'subiekt-bridge-reachability-sweep',
      platformType: 'subiekt',
      jobType: 'subiekt.bridge.reachabilitySweep',
      cronExpression: SUBIEKT_BRIDGE_REACHABILITY_SWEEP_CRON,
      enabledEnvVar: 'OL_SUBIEKT_BRIDGE_REACHABILITY_SWEEP_SCHEDULER_ENABLED',
      generatePayload: () => ({
        schemaVersion: 1,
      }),
      generateIdempotencyKey: (connection, timestamp) =>
        `subiekt:${connection.id}:bridge:reachability:sweep:${timestamp}`,
    },
  ];
}
