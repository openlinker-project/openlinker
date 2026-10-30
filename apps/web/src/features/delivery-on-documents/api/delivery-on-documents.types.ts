/**
 * Delivery on documents - API wire types (#3908, ADR-079)
 *
 * Mirrors the response DTOs of the two read endpoints from #3907:
 * `GET /sales-documents/delivery-line/suggestions` and
 * `GET /connections/:id/delivery-line/country-facts`.
 *
 * @module apps/web/src/features/delivery-on-documents/api
 */

export interface DeliveryLineSuggestionSource {
  term: string;
  text: string;
}

/** A per-country starting point with a citable source. Fills fields; never a rule. */
export interface DeliveryLineSuggestion {
  country: string;
  defaultName: string;
  nameSuggestions: string[];
  rateMode: 'goods' | 'fixed';
  omitFreeDelivery: boolean;
  sources: DeliveryLineSuggestionSource[];
  sourceLabel: string;
  sourceUrl: string;
  disclaimer: string;
}

export interface DeliveryLineSuggestionsResponse {
  suggestions: DeliveryLineSuggestion[];
}

export interface DeliveryCountryExampleLine {
  name: string;
  gross: number;
  rate: string | null;
}

export interface DeliveryCountryExample {
  lines: DeliveryCountryExampleLine[];
  delivery: number | null;
}

/** What OpenLinker actually sees in one buyer country's recent orders. */
export interface DeliveryCountryFact {
  country: string;
  orders30d: number;
  ratesSeen: string[];
  currency: string | null;
  example: DeliveryCountryExample | null;
}

export interface DeliveryCountryFactsResponse {
  windowDays: number;
  countries: DeliveryCountryFact[];
}
