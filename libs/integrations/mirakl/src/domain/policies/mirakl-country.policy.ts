/**
 * Mirakl Country Policy
 *
 * Mirakl addresses carry `country_iso_code` as ISO 3166-1 alpha-3 (`POL`),
 * while OpenLinker addresses use alpha-2 (`PL`). The table covers the countries
 * Empik ships to (the EU) plus the European neighbours a buyer can live in. A
 * two-letter value passes through, and an unknown three-letter code is
 * returned unchanged, so a missing entry degrades to the raw code rather than
 * to an empty country.
 *
 * @module libs/integrations/mirakl/src/domain/policies
 */

const ALPHA2_BY_ALPHA3: Readonly<Record<string, string>> = {
  AUT: 'AT',
  BEL: 'BE',
  BGR: 'BG',
  CHE: 'CH',
  CYP: 'CY',
  CZE: 'CZ',
  DEU: 'DE',
  DNK: 'DK',
  ESP: 'ES',
  EST: 'EE',
  FIN: 'FI',
  FRA: 'FR',
  GBR: 'GB',
  GRC: 'GR',
  HRV: 'HR',
  HUN: 'HU',
  IRL: 'IE',
  ISL: 'IS',
  ITA: 'IT',
  LIE: 'LI',
  LTU: 'LT',
  LUX: 'LU',
  LVA: 'LV',
  MLT: 'MT',
  NLD: 'NL',
  NOR: 'NO',
  POL: 'PL',
  PRT: 'PT',
  ROU: 'RO',
  SVK: 'SK',
  SVN: 'SI',
  SWE: 'SE',
  UKR: 'UA',
};

export function toAlpha2Country(code: string | undefined): string | undefined {
  const value = code?.trim().toUpperCase();
  if (!value) {
    return undefined;
  }
  if (value.length === 2) {
    return value;
  }
  return ALPHA2_BY_ALPHA3[value] ?? value;
}
