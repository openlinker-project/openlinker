/**
 * eparagony.pl Seller Details - Form Shape and Invoice Readiness
 *
 * The seller fields an eparagony.pl INVOICE carries: `merchantTIN`,
 * `merchantName` and `merchantAddress`. They had no control anywhere in the
 * product, so a connection with the invoicing lane enabled could be saved, look
 * healthy, and refuse every invoice it was asked for - the adapter rejects an
 * invoice with no seller tax number before anything is sent, and the host
 * reported that as "rejected by the provider".
 *
 * `readSellerReadiness` states what the adapter will do with the values on the
 * form, and it mirrors two rules in `eparagony-invoice.mapper.ts`:
 *
 *   - an invoice needs `merchantTIN` (`composeInvoiceDocument`);
 *   - a correction needs `merchantTIN`, `merchantName` AND a complete
 *     `merchantAddress` (`composeCorrectiveInvoiceDocument`).
 *
 * Name and address are optional on a plain invoice - the mapper prints them
 * when present - so a missing name is reported as "corrections will be
 * refused", never as "invoices will be refused". Saying more than the adapter
 * enforces would be the stricter-than-the-gate mistake #2240 names.
 *
 * The two required-field sets below are that mirror, and
 * `scripts/check-eparagony-config-mirror.mjs` compares them against the
 * refusals in both mapper functions, so a rule tightened or relaxed in the
 * adapter fails the build instead of leaving this summary making a false claim.
 *
 * @module plugins/eparagony
 */

export const SELLER_ADDRESS_PARTS = [
  'street',
  'number',
  'apartment',
  'postalCode',
  'city',
  'country',
] as const;

export type SellerAddressPart = (typeof SELLER_ADDRESS_PARTS)[number];

/** Every part the backend validator requires once an address is given. */
export const SELLER_ADDRESS_REQUIRED_PARTS: readonly SellerAddressPart[] = [
  'street',
  'number',
  'postalCode',
  'city',
  'country',
];

/** The form field each `merchantAddress` part is edited through. */
export const SELLER_ADDRESS_FORM_FIELDS = {
  street: 'eparagonyMerchantStreet',
  number: 'eparagonyMerchantNumber',
  apartment: 'eparagonyMerchantApartment',
  postalCode: 'eparagonyMerchantPostalCode',
  city: 'eparagonyMerchantCity',
  country: 'eparagonyMerchantCountry',
} as const satisfies Record<SellerAddressPart, string>;

export type SellerAddressParts = Record<SellerAddressPart, string>;

/**
 * - `missing-tin`: every invoice is refused before it reaches eparagony.pl.
 * - `invoices-only`: invoices are issued; a correction is refused, because it
 *   also needs the seller's name and a complete address.
 * - `complete`: invoices and corrections both have what they need.
 */
export const SellerReadinessValues = ['missing-tin', 'invoices-only', 'complete'] as const;

export type SellerReadiness = (typeof SellerReadinessValues)[number];

function readTrimmed(values: Record<string, unknown>, key: string): string {
  const value = values[key];
  return typeof value === 'string' ? value.trim() : '';
}

export function readSellerAddressParts(values: Record<string, unknown>): SellerAddressParts {
  return {
    street: readTrimmed(values, SELLER_ADDRESS_FORM_FIELDS.street),
    number: readTrimmed(values, SELLER_ADDRESS_FORM_FIELDS.number),
    apartment: readTrimmed(values, SELLER_ADDRESS_FORM_FIELDS.apartment),
    postalCode: readTrimmed(values, SELLER_ADDRESS_FORM_FIELDS.postalCode),
    city: readTrimmed(values, SELLER_ADDRESS_FORM_FIELDS.city),
    country: readTrimmed(values, SELLER_ADDRESS_FORM_FIELDS.country),
  };
}

export function hasAnySellerAddressPart(parts: SellerAddressParts): boolean {
  return SELLER_ADDRESS_PARTS.some((part) => parts[part] !== '');
}

/**
 * Complete in the sense the adapter's `readSellerEntityAddress` uses: every
 * required part present and the country a two-letter code. A malformed country
 * makes the address unusable rather than merely ugly, so it counts as missing.
 */
export function isSellerAddressComplete(parts: SellerAddressParts): boolean {
  return (
    SELLER_ADDRESS_REQUIRED_PARTS.every((part) => parts[part] !== '') &&
    /^[A-Za-z]{2}$/.test(parts.country)
  );
}

export type SellerConfigField = 'merchantTIN' | 'merchantName' | 'merchantAddress';

/** The seller fields `composeInvoiceDocument` refuses an invoice without. */
export const INVOICE_REQUIRED_SELLER_FIELDS = [
  'merchantTIN',
] as const satisfies readonly SellerConfigField[];

/** The seller fields `composeCorrectiveInvoiceDocument` refuses a correction without. */
export const CORRECTION_REQUIRED_SELLER_FIELDS = [
  'merchantTIN',
  'merchantName',
  'merchantAddress',
] as const satisfies readonly SellerConfigField[];

function isSellerFieldPresent(values: Record<string, unknown>, field: SellerConfigField): boolean {
  switch (field) {
    case 'merchantTIN':
      return readTrimmed(values, 'eparagonyMerchantTIN') !== '';
    case 'merchantName':
      return readTrimmed(values, 'eparagonyMerchantName') !== '';
    case 'merchantAddress':
      return isSellerAddressComplete(readSellerAddressParts(values));
  }
}

export function readSellerReadiness(values: Record<string, unknown>): SellerReadiness {
  const present = (field: SellerConfigField): boolean => isSellerFieldPresent(values, field);
  if (!INVOICE_REQUIRED_SELLER_FIELDS.every(present)) return 'missing-tin';
  return CORRECTION_REQUIRED_SELLER_FIELDS.every(present) ? 'complete' : 'invoices-only';
}
