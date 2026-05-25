/**
 * Shipment Parcel Types
 *
 * Carrier-neutral parcel descriptor for a label-generation command. A
 * shipment is described EITHER by a carrier size `template` (locker
 * shipments — the operator / connection picks a locker size, since an order
 * carries no reliable per-item dimensions) OR by explicit `dimensions` +
 * `weightGrams` (courier). Adapters validate the right combination per
 * shipping method and translate to the provider's parcel shape (e.g. ShipX
 * `parcels` object for lockers vs array for courier).
 *
 * @module libs/core/src/shipping/domain/types
 */

export interface ShipmentDimensions {
  /** Millimetres. */
  length: number;
  width: number;
  height: number;
}

export interface ShipmentParcel {
  /** Carrier size code — locker shipments (e.g. InPost `'small' | 'medium' | 'large'`). */
  template?: string;
  /** Explicit dimensions (mm) — courier shipments. */
  dimensions?: ShipmentDimensions;
  /** Weight in grams — courier shipments. */
  weightGrams?: number;
}
