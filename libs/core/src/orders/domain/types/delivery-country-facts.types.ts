/**
 * Delivery Country Facts Types (#3907, ADR-079 decision 8)
 *
 * What one source connection's recent orders say about each delivery country:
 * how many, which VAT rates its lines carried, which currency, and one
 * anonymous example order. It feeds the delivery-line editor so an operator
 * sees "these are the rates your Polish orders really carry" beside the
 * curated suggestion for that country.
 *
 * Deliberately carries NO buyer data. The example is item labels, amounts and
 * rates only - never a name, an email or an address - because the surface that
 * renders it is readable by viewers.
 *
 * @module libs/core/src/orders/domain/types
 */

/** One line of the example order, as it priced on the order itself. */
export interface DeliveryCountryExampleLine {
  readonly name: string;
  /** Line total (unit gross, falling back to unit price, times quantity). */
  readonly gross: number;
  /** The settled rate code the line carried, or null when it carried none. */
  readonly rate: string | null;
}

/** The latest ready order of a country, reduced to what a preview needs. */
export interface DeliveryCountryExample {
  readonly lines: readonly DeliveryCountryExampleLine[];
  /** Shipping as the order reports it (gross when the source reports gross), or null. */
  readonly delivery: number | null;
}

export interface DeliveryCountryFact {
  /** Upper-cased delivery-address country, the same expression routing evaluates on. */
  readonly country: string;
  readonly orders: number;
  /** Distinct line rate codes seen in the window, most frequent first. */
  readonly ratesSeen: readonly string[];
  /** Most frequent order currency, or null when none was recorded. */
  readonly currency: string | null;
  readonly example: DeliveryCountryExample | null;
}
