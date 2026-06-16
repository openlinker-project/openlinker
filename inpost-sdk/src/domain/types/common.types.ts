/**
 * Common ShipX wire types shared across resources.
 *
 * @module domain/types
 */

/** ShipX collection envelope returned by list endpoints. */
export interface Paged<T> {
  readonly href: string;
  readonly count: number;
  readonly page: number;
  readonly per_page: number;
  readonly total_pages?: number;
  readonly items: ReadonlyArray<T>;
}

export interface Address {
  readonly id?: number;
  readonly street?: string | null;
  readonly building_number?: string | null;
  readonly line1?: string | null;
  readonly line2?: string | null;
  readonly city?: string | null;
  readonly post_code?: string | null;
  readonly country_code?: string | null;
}

export interface MonetaryAmount {
  readonly amount: string | number;
  readonly currency: string;
}
