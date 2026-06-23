/**
 * FA(3) Buyer-Identity Mapper (`TaxIdentifier.scheme` → `Podmiot2` choice)
 *
 * Pure resolution of the neutral, scheme-tagged buyer `TaxIdentifier` onto the
 * mutually-exclusive FA(3) `Podmiot2` identification choice. PL-specific
 * (ADR-026): the four shapes map to NIP / KodUE+NrVatUE / KodKraju+NrID /
 * BrakID. Validation (NIP 10-digit, EU-VAT country-prefix) is enforced here —
 * an invalid identifier throws `InvalidBuyerIdentificationException` rather than
 * emitting a structurally-valid-but-wrong document for the XSD to (not) catch.
 *
 * The scheme→branch table + per-branch validation regexes are documented in
 * FA3_IMPLEMENTATION_NOTES.md. The canonical neutral scheme set is still being
 * settled upstream and MUST be reconciled before C3 submission.
 *
 * @module libs/integrations/ksef/src/infrastructure/fa3/domain
 */
import type { TaxIdentifier } from '@openlinker/core/invoicing';
import { InvalidBuyerIdentificationException } from '../../../domain/exceptions/fa3-builder.exception';

/**
 * Resolved FA(3) `Podmiot2` identity — a discriminated union the builder pattern
 * -matches to populate exactly one identification element.
 *
 * - `nip`   → domestic Polish buyer (`<NIP>`).
 * - `vat`   → EU buyer (`<KodUE>` + `<NrVatUE>`).
 * - `other` → non-EU foreign buyer (`<KodKraju>` + `<NrID>`).
 * - `none`  → B2C / no tax id (`<BrakID>1</BrakID>`).
 */
export type BuyerIdentity =
  | { kind: 'nip'; nip: string }
  | { kind: 'vat'; countryCode: string; vatNumber: string }
  | { kind: 'other'; countryCode: string; id: string }
  | { kind: 'none' };

/** Polish NIP: exactly 10 digits. */
export const NIP_PATTERN = /^\d{10}$/;

/** EU VAT: 2-letter country prefix followed by an alphanumeric body. */
export const EU_VAT_PATTERN = /^([A-Z]{2})([A-Za-z0-9]+)$/;

/**
 * Resolve a neutral buyer `TaxIdentifier` (or `null` for B2C) to the FA(3)
 * `Podmiot2` choice.
 *
 * @throws {InvalidBuyerIdentificationException} on a malformed identifier.
 */
export function resolveBuyerIdentity(taxId: TaxIdentifier | null): BuyerIdentity {
  // B2C / no tax id → BrakID.
  if (taxId === null) {
    return { kind: 'none' };
  }

  const scheme = taxId.scheme.toLowerCase();
  const value = taxId.value.trim();

  // Domestic Polish buyer → <NIP> (10 digits).
  if (scheme === 'pl-nip') {
    if (!NIP_PATTERN.test(value)) {
      throw new InvalidBuyerIdentificationException(taxId.scheme, 'NIP must be exactly 10 digits');
    }
    return { kind: 'nip', nip: value };
  }

  // EU buyer → <KodUE> + <NrVatUE>. The 2-letter prefix is the country code; the
  // remainder is the VAT body. A bare `PL`-prefixed VAT is treated as EU-VAT too
  // (the adapter routes domestic buyers via `pl-nip`).
  if (scheme === 'eu-vat' || scheme === 'eu-vat-id') {
    const match = EU_VAT_PATTERN.exec(value);
    if (!match) {
      throw new InvalidBuyerIdentificationException(
        taxId.scheme,
        'EU VAT must be a 2-letter country prefix followed by an alphanumeric body',
      );
    }
    return { kind: 'vat', countryCode: match[1], vatNumber: match[2] };
  }

  // Any other foreign scheme → <KodKraju> + <NrID>. The value carries an
  // ISO 3166-1 alpha-2 country prefix; the remainder is the national id.
  const foreign = EU_VAT_PATTERN.exec(value);
  if (!foreign) {
    throw new InvalidBuyerIdentificationException(
      taxId.scheme,
      'foreign identifier must carry a 2-letter country prefix and an id body',
    );
  }
  return { kind: 'other', countryCode: foreign[1], id: foreign[2] };
}
