/**
 * Amazon Package Reference Policy (#4178)
 *
 * `confirmShipment` needs a `packageReferenceId` that identifies the package
 * within the order, and Amazon accepts only a positive number there
 * (`PackageReferenceId`, Orders API v0 model). A tracking number is often
 * alphanumeric, so it cannot be sent as is.
 *
 * The reference is derived from the tracking number: the same parcel gives the
 * same reference on a retry, and two parcels of one order give different ones.
 * It is the first 13 hex digits of the SHA-256 of the tracking number read as
 * a decimal number, plus one so it is never zero; 13 hex digits stay below
 * `Number.MAX_SAFE_INTEGER`.
 *
 * @module libs/integrations/amazon/src/domain/policies
 */
import { createHash } from 'node:crypto';

const HASH_HEX_DIGITS = 13;

export function amazonPackageReferenceId(trackingNumber: string): string {
  const digest = createHash('sha256').update(trackingNumber.trim()).digest('hex');
  return String(Number.parseInt(digest.slice(0, HASH_HEX_DIGITS), 16) + 1);
}
