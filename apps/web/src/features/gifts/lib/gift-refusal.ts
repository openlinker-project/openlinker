/**
 * Reading a refused add-gift (#3940)
 *
 * The order-edit endpoint answers a refusal with a machine code in `error`. For
 * a gift only a few matter: the parcel is closed (packed or shipped) or the
 * order is cancelled or a label was already bought, all of which read as one
 * sentence to the operator - "the parcel is closed"; an order that has not
 * finished importing is the one other refusal with its own sentence. Anything else shows the server's own message.
 *
 * @module apps/web/src/features/gifts/lib
 */
import { ApiError } from '../../../shared/api/api-error';
import { describeApiError } from '../../../shared/api/describe-api-error';

const PARCEL_CLOSED_CODES = [
  'ORDER_PACKED',
  'ORDER_ALREADY_SHIPPED',
  'ORDER_ALREADY_CANCELLED',
  'LABEL_ALREADY_BOUGHT',
] as const;
const NOT_READY_CODES = ['ORDER_NOT_READY'] as const;

export type AddGiftRefusal = 'parcel-closed' | 'not-ready' | 'other';

export function readAddGiftRefusal(
  error: unknown
): { kind: AddGiftRefusal; message: string } | null {
  if (!(error instanceof ApiError)) return null;
  const details = error.details;
  const code =
    typeof details === 'object' && details !== null && 'error' in details
      ? String((details as { error: unknown }).error)
      : '';
  if ((PARCEL_CLOSED_CODES as readonly string[]).includes(code)) {
    return { kind: 'parcel-closed', message: describeApiError(error, 'gifts') };
  }
  if ((NOT_READY_CODES as readonly string[]).includes(code)) {
    return { kind: 'not-ready', message: describeApiError(error, 'gifts') };
  }
  return { kind: 'other', message: describeApiError(error, 'gifts') };
}
