/**
 * Shoper Parcel Types
 *
 * What the fulfillment writeback (#3643) must do for one `dispatched` event,
 * decided from the parcels the Shoper order already has.
 *
 * @module libs/integrations/shoper/src/domain/types
 */

export type ShoperParcelPlan =
  | { readonly kind: 'create' }
  | { readonly kind: 'attach-tracking'; readonly parcelId: string }
  | { readonly kind: 'already-applied' }
  /**
   * The order already has parcel(s) under other tracking numbers. A further parcel
   * without `products[]` would ship a remainder of zero, and OpenLinker cannot say
   * what a second shipment carries (no lines on the event), so nothing is written.
   */
  | { readonly kind: 'conflict' };
