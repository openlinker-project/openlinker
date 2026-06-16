/**
 * Parcel point (Paczkomat / PUDO) wire types — the `apipoints` resource.
 *
 * @module domain/types
 */

export interface PointAddress {
  readonly line1: string | null;
  readonly line2: string | null;
}

export interface PointAddressDetails {
  readonly city: string | null;
  readonly province: string | null;
  readonly post_code: string | null;
  readonly street: string | null;
  readonly building_number: string | null;
  readonly flat_number: string | null;
}

export interface Point {
  readonly href: string;
  /** The locker/point code used as `custom_attributes.target_point`, e.g. `KRA012`. */
  readonly name: string;
  readonly type: ReadonlyArray<string>;
  readonly status: string;
  readonly location: { readonly longitude: number; readonly latitude: number };
  readonly address: PointAddress;
  readonly address_details: PointAddressDetails;
  readonly opening_hours: string | null;
  /** Capabilities such as `parcel_collect`, `parcel_send`. */
  readonly functions: ReadonlyArray<string>;
  readonly [extra: string]: unknown;
}

export interface PointsQuery {
  readonly page?: number;
  readonly per_page?: number;
  /** Point code to compute distances relative to. */
  readonly relative_point?: string;
  readonly relative_post_code?: string;
  /** e.g. `parcel_locker`. */
  readonly type?: string;
  readonly status?: string;
  /** Comma-separated required functions, e.g. `parcel_collect`. */
  readonly functions?: string;
}
