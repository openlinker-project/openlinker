/**
 * Delivery-Line Suggestion Catalogue (#3907, ADR-079 decision 8)
 *
 * Country-keyed curated suggestions for how a sales document's delivery line
 * is named and rated: a default label, alternative labels, which rate mode is
 * customary and the public sources that say so. Poland is the only entry.
 *
 * Ships as DATA in `apps/api`, never as a literal inside
 * `libs/core/src/sales-documents/**`, which carries no market-specific content
 * (the same reason the starter-template catalogue lives beside this file).
 * Absence is a first-class answer: a country with no entry resolves `null`
 * from {@link getDeliveryLineSuggestion} and is simply missing from
 * {@link listDeliveryLineSuggestions}, so a surface can say "we have no
 * suggestion for this market" instead of showing an empty one.
 *
 * Suggestions are never applied automatically: reading the catalogue changes
 * nothing, and the operator chooses what to save.
 *
 * @module apps/api/src/sales-documents/data
 * @see docs/architecture/adrs/079-delivery-line-on-sales-documents.md
 */

export type DeliveryLineRateMode = 'goods' | 'fixed';

export interface DeliveryLineSuggestionSource {
  readonly term: string;
  readonly text: string;
}

export interface DeliveryLineSuggestion {
  readonly country: string;
  readonly defaultName: string;
  readonly nameSuggestions: readonly string[];
  /** `goods`: the delivery follows the VAT rate of the goods it ships with. */
  readonly rateMode: DeliveryLineRateMode;
  /** Whether a delivery line is left off the document when delivery is free. */
  readonly omitFreeDelivery: boolean;
  readonly sources: readonly DeliveryLineSuggestionSource[];
  readonly sourceLabel: string;
  readonly sourceUrl: string;
  readonly disclaimer: string;
}

const SUGGESTION_DISCLAIMER = 'Suggested settings, not legal advice. Check them with your accountant.';

const POLAND_SUGGESTION: DeliveryLineSuggestion = {
  country: 'PL',
  defaultName: 'Koszt dostawy',
  nameSuggestions: ['Koszt dostawy', 'Dostawa', 'Wysyłka', 'Kurier', 'Paczkomat InPost', 'Transport'],
  rateMode: 'goods',
  omitFreeDelivery: true,
  sources: [
    {
      term: 'VAT rate follows the goods',
      text: 'Art. 29a ust. 6 pkt 2 ustawy o VAT: delivery charged to the buyer is part of the price of the goods. KIS 0114-KDIP1-3.4012.662.2023.1.PRM (7 Dec 2023) confirms it even when delivery is a separate line and the buyer picks the carrier.',
    },
    {
      term: 'Split by value',
      text: 'For a basket with several VAT rates, tax authority interpretations accept splitting delivery in proportion to the value of the goods. Charging all delivery at 23% was ruled incorrect.',
    },
    {
      term: 'Rate in the receipt line name',
      text: 'Dz.U. 2024 poz. 1654, § 2 and § 40: a fiscal printer refuses a name whose VAT rate went up after it went down. One name per rate never changes rate. The % sign is allowed in names.',
    },
  ],
  sourceLabel: 'Dz.U. 2024 poz. 1654 (isap.sejm.gov.pl)',
  sourceUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20240001654',
  disclaimer: SUGGESTION_DISCLAIMER,
};

const SUGGESTIONS_BY_COUNTRY: Readonly<Record<string, DeliveryLineSuggestion>> = {
  PL: POLAND_SUGGESTION,
};

/** `null` when no curated suggestion exists for `country` (every country but Poland, today). */
export function getDeliveryLineSuggestion(country: string): DeliveryLineSuggestion | null {
  return SUGGESTIONS_BY_COUNTRY[country.trim().toUpperCase()] ?? null;
}

/** Every curated suggestion, alphabetically by country. */
export function listDeliveryLineSuggestions(): DeliveryLineSuggestion[] {
  return Object.values(SUGGESTIONS_BY_COUNTRY).sort((a, b) => a.country.localeCompare(b.country));
}
