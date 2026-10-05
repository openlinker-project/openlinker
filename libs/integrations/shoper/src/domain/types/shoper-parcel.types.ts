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
  | { readonly kind: 'already-applied' };
