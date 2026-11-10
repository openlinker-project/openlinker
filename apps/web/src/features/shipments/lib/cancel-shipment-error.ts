/**
 * Cancel-shipment error classification
 *
 * Turns a failed `POST /shipments/:id/cancel` into the kind of message the
 * cancel dialog shows. Chosen by HTTP status, because the endpoint carries no
 * machine-readable error code yet. The server `message` is never shown: a 502
 * body can echo the carrier's own text, which may carry address fragments.
 *
 * - 502 with a `providerCode`: the carrier refused (InPost refuses once a
 *   shipment is confirmed). The API also answers 502 when the carrier rejects
 *   our credentials, and a proxy can answer 502 too; neither carries a
 *   `providerCode`, so both fall through to the unknown outcome rather than
 *   telling the operator the parcel is confirmed.
 * - 409: the shipment is already in a terminal state.
 * - 422: the carrier does not support cancelling at all.
 * - anything else: unknown outcome (a timeout may still have reached the carrier).
 *
 * @module apps/web/src/features/shipments/lib
 */
import { ApiError } from '../../../shared/api/api-error';

export const CancelShipmentErrorKindValues = [
  'carrier-refused',
  'no-longer-active',
  'not-supported',
  'failed',
] as const;
export type CancelShipmentErrorKind = (typeof CancelShipmentErrorKindValues)[number];

export function classifyCancelShipmentError(error: unknown): CancelShipmentErrorKind {
  if (!(error instanceof ApiError)) return 'failed';
  if (error.status === 502 && hasProviderCode(error.details)) return 'carrier-refused';
  if (error.status === 409) return 'no-longer-active';
  if (error.status === 422) return 'not-supported';
  return 'failed';
}

function hasProviderCode(details: unknown): boolean {
  return (
    typeof details === 'object' &&
    details !== null &&
    'providerCode' in details &&
    typeof details.providerCode === 'string' &&
    details.providerCode.length > 0
  );
}

/**
 * Whether pressing "Cancel shipment" again could change the answer. A terminal
 * shipment and a carrier with no cancel support answer the same way every time.
 */
export function canRetryCancelShipment(kind: CancelShipmentErrorKind): boolean {
  return kind === 'carrier-refused' || kind === 'failed';
}
