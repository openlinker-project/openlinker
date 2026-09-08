/**
 * Waybill-relay escalation threshold — the one place `process.env` is read (#2073)
 *
 * `resolveWaybillRelayAlertThreshold` in `@openlinker/core/shipping` owns the
 * RULE (the default and the clamps); this owns the single read of the variable
 * that feeds it, so the filter that selects the stuck bucket and the badge
 * rendered on each row cannot be computed from two different numbers — the
 * reported-versus-enforced gap #2229 exists to close.
 *
 * Read by the **api** process only. The worker increments the counter and never
 * compares it, so this variable is documented in `apps/api/.env.example` and
 * deliberately not in the worker's — an env rung answers for the process that
 * reads it, and listing it where nothing reads it is how an operator comes to
 * believe they have changed something they have not.
 *
 * Resolved per call rather than cached at boot, matching how the AI provider
 * setting is read on every completion: one `process.env` lookup is far cheaper
 * than an operator discovering their change needs a restart.
 *
 * @module apps/api/src/shipping/http
 */
import { resolveWaybillRelayAlertThreshold } from '@openlinker/core/shipping';

export const WAYBILL_RELAY_ALERT_THRESHOLD_ENV = 'OL_WAYBILL_RELAY_FAILURE_ALERT_THRESHOLD';

export function resolveWaybillRelayThresholdFromEnv(): number {
  return resolveWaybillRelayAlertThreshold(process.env[WAYBILL_RELAY_ALERT_THRESHOLD_ENV]);
}
