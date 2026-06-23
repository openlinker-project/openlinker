/**
 * FA(3) Currency Mapper (ISO-4217 → `KodWaluty`)
 *
 * Pure validation/mapping of the neutral `IssueInvoiceCommand.currency`
 * (ISO-4217) onto the FA(3) `KodWaluty` allow-list. PL-specific (ADR-026).
 * An unsupported currency throws `UnsupportedCurrencyException` — the builder
 * never silently coerces to PLN.
 *
 * @module libs/integrations/ksef/src/infrastructure/fa3/domain
 */
import { UnsupportedCurrencyException } from '../../../domain/exceptions/fa3-builder.exception';
import { Fa3KodWalutyValues, type Fa3KodWaluty } from './fa3-schema.types';

/**
 * Resolve an ISO-4217 currency to its FA(3) `KodWaluty`.
 *
 * @throws {UnsupportedCurrencyException} when the currency is outside the allow-list.
 */
export function resolveKodWaluty(currency: string): Fa3KodWaluty {
  const normalized = currency.trim().toUpperCase();
  const match = Fa3KodWalutyValues.find((code) => code === normalized);
  if (match === undefined) {
    throw new UnsupportedCurrencyException(currency);
  }
  return match;
}
