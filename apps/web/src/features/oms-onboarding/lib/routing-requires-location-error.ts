/**
 * Routing-requires-location error code (#3457)
 *
 * `ConnectionService` refuses to switch sourcing on while no active inventory
 * location exists (#2407), answering 400 with a machine-readable `error`
 * field. Step 4 maps it to an inline remedy and must branch on the code, never
 * on the message, which the backend is free to reword.
 *
 * Mirrors `ROUTING_REQUIRES_ACTIVE_LOCATION_ERROR_CODE` in
 * `apps/api/src/integrations/application/services/connection.service.ts`
 * verbatim — the browser bundle cannot import backend code (#591).
 *
 * @module features/oms-onboarding/lib
 */
import { ApiError } from '../../../shared/api/api-error';

export const ROUTING_REQUIRES_ACTIVE_LOCATION_ERROR_CODE = 'ROUTING_REQUIRES_ACTIVE_LOCATION';

export function isRoutingRequiresLocationError(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 400) return false;
  const details = error.details;
  if (typeof details !== 'object' || details === null) return false;
  return (details as { error?: unknown }).error === ROUTING_REQUIRES_ACTIVE_LOCATION_ERROR_CODE;
}
