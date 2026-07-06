/**
 * FA(3) Country Code Mapper (ISO-3166 alpha-2 -> `KodKraju`)
 *
 * Pure validation/mapping of a neutral address `countryIso2` onto the FA(3)
 * `TKodKraju` closed enumeration (uppercase-only; KSeF rejects lowercase codes
 * at schema validation). PL-specific (ADR-026). Source adapters may deliver
 * lowercase codes (e.g. Erli's "pl"), so the value is trim + uppercase
 * normalised before membership validation. An unknown code throws
 * `UnsupportedCountryCodeException` - a deterministic build fault raised
 * before any submit happens.
 *
 * @module libs/integrations/ksef/src/infrastructure/fa3/domain
 */
import { UnsupportedCountryCodeException } from '../../../domain/exceptions/fa3-builder.exception';
import { Fa3KodKrajuValues, type Fa3KodKraju } from './fa3-country-code.types';

/**
 * Resolve an ISO-3166 alpha-2 country code to its FA(3) `KodKraju`.
 *
 * @throws {UnsupportedCountryCodeException} when the code is outside the `TKodKraju` enumeration.
 */
export function resolveKodKraju(value: string): Fa3KodKraju {
  const normalized = value.trim().toUpperCase();
  const match = Fa3KodKrajuValues.find((code) => code === normalized);
  if (match === undefined) {
    throw new UnsupportedCountryCodeException(value);
  }
  return match;
}
