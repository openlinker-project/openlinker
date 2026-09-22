/**
 * stock-location-override error code (#3206/#3207 review)
 *
 * `ConnectionService.validateStockLocationOverride` answers 400 for all three
 * `config.stockLocationOverride` failures (not-a-non-empty-string, unknown
 * location, retired location) carrying a machine-readable `error` field in
 * the body — the `ORDER_ALREADY_ON_HOLD` / `HOLD_ALREADY_RELEASED` precedent
 * (#2341). `EditConnectionForm.onSubmit` branches on this code rather than on
 * `error.message.includes('stockLocationOverride')`, which matched on prose
 * the backend is free to reword — a rewording of any of the three messages
 * would have silently reverted the field-level error to the generic banner.
 *
 * The value must match
 * `apps/api/src/integrations/application/services/connection.service.ts`'s
 * `STOCK_LOCATION_OVERRIDE_INVALID_ERROR_CODE` verbatim — the browser bundle
 * cannot import backend code (#591), so this is a deliberate mirror rather
 * than a shared import.
 *
 * @module apps/web/src/features/connections/lib
 */
import { ApiError } from '../../../shared/api/api-error';

export const STOCK_LOCATION_OVERRIDE_INVALID_ERROR_CODE = 'STOCK_LOCATION_OVERRIDE_INVALID';

/** True when `error` is the backend's stock-location-override validation refusal. */
export function isStockLocationOverrideValidationError(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 400) return false;
  const details = error.details;
  if (typeof details !== 'object' || details === null) return false;
  const code = (details as { error?: unknown }).error;
  return code === STOCK_LOCATION_OVERRIDE_INVALID_ERROR_CODE;
}
