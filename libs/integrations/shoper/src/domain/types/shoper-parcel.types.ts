/**
 * Shoper Parcel Types
 *
 * What the fulfillment writeback (#3643) must do for one `dispatched` event,
 * decided from the parcels the Shoper order already has.
 *
 * @module libs/integrations/shoper/src/domain/types
 */
import type { ShoperApiError } from '../exceptions/shoper-api.error';

export type ShoperParcelPlan =
  | { readonly kind: 'create' }
  /**
   * `alreadySent`: Shoper refuses any `PUT /parcels/:id` that names the sent flag
   * once the parcel is sent (`parcel_already_sent`), so the tracking number must
   * then travel alone.
   */
  | { readonly kind: 'attach-tracking'; readonly parcelId: string; readonly alreadySent: boolean }
  | { readonly kind: 'already-applied' }
  /**
   * The order already has parcel(s) under other tracking numbers. A further parcel
   * without `products[]` would ship a remainder of zero, and OpenLinker cannot say
   * what a second shipment carries (no lines on the event), so nothing is written.
   */
  | { readonly kind: 'conflict' };

/**
 * The shipping method a new parcel is written under, and why that one: the
 * order's own method (always tried first), else the operator's
 * `defaults.parcelShippingId`, else the shop's first plain (non-integrated)
 * method.
 */
export interface ShoperParcelShippingChoice {
  readonly shippingId: number;
  readonly source: 'config' | 'order' | 'fallback';
}

/** What one `POST /parcels` attempt came to; any other failure is thrown and surfaces as `rejected`. */
export type ShoperParcelPostOutcome =
  | { readonly kind: 'created' }
  /** Shoper refused the shipping method itself; it created nothing, so another method may be tried. */
  | { readonly kind: 'method-refused'; readonly error: ShoperApiError }
  /** Any other 400: the request is wrong in a way another method would not fix. */
  | { readonly kind: 'rejected'; readonly error: ShoperApiError };
