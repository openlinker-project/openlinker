/**
 * Field- and amount-parity assertions
 *
 * The golden path verifies *every parameter and every amount*, not pixels. These
 * helpers make that comparison honest:
 *
 *   - Money is compared in **minor units** (integer cents/grosze), currency-aware
 *     via an exponent table, so `19.9`, `19.90` and `"19.900"` all reconcile and
 *     no float drift ever fails a run.
 *   - Field parity is asserted **field-by-field** with per-field messages, so a
 *     failure names the field, the expected value and the actual value.
 *
 * @module support
 */
import { expect } from '@playwright/test';
import type {
  CategoryParameter,
  IssuedDocumentContent,
  MarketplaceOffer,
} from '../api/api.types';

/** Currencies whose minor unit is not 10^-2. Everything else defaults to 2. */
const CURRENCY_EXPONENT: Readonly<Record<string, number>> = {
  JPY: 0,
  KRW: 0,
  HUF: 0,
  ISK: 0,
  BHD: 3,
  KWD: 3,
  OMR: 3,
  TND: 3,
};

/** Minor-unit exponent for an ISO 4217 code (default 2). */
export function minorUnitExponent(currency: string): number {
  return CURRENCY_EXPONENT[currency.toUpperCase()] ?? 2;
}

/**
 * Convert a decimal amount (number or string) to integer minor units for a
 * currency. Rounds half-up at the currency's precision to absorb float noise.
 */
export function toMinorUnits(amount: number | string, currency: string): number {
  const value = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(value)) {
    throw new Error(`Cannot convert non-numeric amount "${amount}" to minor units`);
  }
  const factor = 10 ** minorUnitExponent(currency);
  return Math.round(value * factor);
}

/** Assert two amounts are equal to the currency's minor unit. */
export function assertMoneyEqual(
  expected: number | string,
  actual: number | string,
  currency: string,
  label: string,
): void {
  const e = toMinorUnits(expected, currency);
  const a = toMinorUnits(actual, currency);
  expect(a, `${label}: expected ${expected} ${currency} (=${e}), got ${actual} ${currency} (=${a})`).toBe(e);
}

/** A normalized view of a product/offer used for cross-surface field parity. */
export interface ProductParityView {
  name?: string | null;
  sku?: string | null;
  ean?: string | null;
  price?: number | string | null;
  currency?: string | null;
  categoryId?: string | null;
  attributes?: Record<string, unknown> | null;
  availableQuantity?: number | null;
}

export interface ProductFieldParityInput {
  label: string;
  expected: ProductParityView;
  actual: ProductParityView;
  /** Currency used for the price comparison (falls back to either view's currency). */
  currency?: string;
}

/**
 * Field-by-field parity between an expected (master) view and an actual (channel)
 * view. Only fields present (non-undefined) in `expected` are asserted, so each
 * surface asserts the subset it actually exposes.
 */
export function assertProductFieldParity(input: ProductFieldParityInput): void {
  const { label, expected, actual } = input;
  const currency = input.currency ?? expected.currency ?? actual.currency ?? 'PLN';

  if (expected.name !== undefined && expected.name !== null) {
    expect(norm(actual.name), `${label} name`).toBe(norm(expected.name));
  }
  if (expected.sku !== undefined && expected.sku !== null) {
    expect(norm(actual.sku), `${label} SKU`).toBe(norm(expected.sku));
  }
  if (expected.ean !== undefined && expected.ean !== null) {
    expect(norm(actual.ean), `${label} EAN`).toBe(norm(expected.ean));
  }
  if (expected.price !== undefined && expected.price !== null) {
    expect(actual.price ?? null, `${label} price present`).not.toBeNull();
    assertMoneyEqual(expected.price, actual.price!, currency, `${label} price`);
  }
  if (expected.currency !== undefined && expected.currency !== null) {
    expect(norm(actual.currency), `${label} currency`).toBe(norm(expected.currency));
  }
  if (expected.categoryId !== undefined && expected.categoryId !== null) {
    expect(String(actual.categoryId ?? ''), `${label} category id`).toBe(String(expected.categoryId));
  }
  if (expected.availableQuantity !== undefined && expected.availableQuantity !== null) {
    expect(actual.availableQuantity ?? null, `${label} available quantity`).toBe(
      expected.availableQuantity,
    );
  }
  if (expected.attributes) {
    for (const [key, value] of Object.entries(expected.attributes)) {
      expect(norm(actual.attributes?.[key]), `${label} attribute "${key}"`).toBe(norm(value));
    }
  }
}

/** Build a parity view from an adapter-fetched marketplace offer. */
export function offerToParityView(offer: MarketplaceOffer): ProductParityView {
  return {
    name: offer.title,
    price: offer.price.amount,
    currency: offer.price.currency,
    categoryId: offer.category?.id ?? null,
    availableQuantity: offer.availableQuantity,
  };
}

export interface ExpectedCategoryParameter {
  name: string;
  section: 'offer' | 'product';
}

/**
 * Assert the category parameter directory exposes every expected parameter, with
 * the right section (offer vs product). This is the OL-exposed slice of offer
 * parameter parity — the per-offer *filled* values are confirmed visually via a
 * manual checkpoint (see the golden-path doc's honest-limits section).
 */
export function assertOfferParameterParity(
  label: string,
  expected: readonly ExpectedCategoryParameter[],
  actual: readonly CategoryParameter[],
): void {
  for (const want of expected) {
    const match = actual.find(
      (p) => norm(p.name) === norm(want.name) && p.section === want.section,
    );
    expect(
      match,
      `${label}: expected ${want.section}-section parameter "${want.name}" in category directory`,
    ).toBeTruthy();
  }
}

export interface ExpectedInvoiceLine {
  net: number | string;
  taxRate?: string;
  taxAmount?: number | string;
  gross: number | string;
}

export interface ExpectedInvoiceAmounts {
  currency: string;
  documentType?: string;
  buyerTaxId?: string;
  lines?: readonly ExpectedInvoiceLine[];
  totals?: { net?: number | string; tax?: number | string; gross?: number | string };
}

/**
 * Assert an issued document's amounts match expectations, money-safe. Compares
 * per-line net/VAT/gross, totals, currency, and (optionally) buyer tax id and
 * document type.
 */
export function assertInvoiceAmounts(
  expected: ExpectedInvoiceAmounts,
  actual: IssuedDocumentContent,
  actualDocumentType?: string,
): void {
  const currency = expected.currency;
  expect(norm(actual.currency), 'invoice currency').toBe(norm(currency));

  if (expected.documentType !== undefined && actualDocumentType !== undefined) {
    expect(norm(actualDocumentType), 'invoice document type').toBe(norm(expected.documentType));
  }
  if (expected.buyerTaxId !== undefined) {
    expect(actual.buyer.taxId?.value ?? null, 'invoice buyer tax id').toBe(expected.buyerTaxId);
  }

  if (expected.lines) {
    expect(actual.lines.length, 'invoice line count').toBe(expected.lines.length);
    expected.lines.forEach((line, i) => {
      const got = actual.lines[i];
      assertMoneyEqual(line.net, got.net, currency, `invoice line ${i + 1} net`);
      assertMoneyEqual(line.gross, got.gross, currency, `invoice line ${i + 1} gross`);
      if (line.taxAmount !== undefined) {
        assertMoneyEqual(line.taxAmount, got.tax, currency, `invoice line ${i + 1} VAT amount`);
      }
      if (line.taxRate !== undefined) {
        expect(norm(got.taxRate), `invoice line ${i + 1} VAT rate`).toBe(norm(line.taxRate));
      }
    });
  }

  if (expected.totals) {
    if (expected.totals.net !== undefined) {
      assertMoneyEqual(expected.totals.net, actual.totals.net, currency, 'invoice total net');
    }
    if (expected.totals.tax !== undefined) {
      assertMoneyEqual(expected.totals.tax, actual.totals.tax, currency, 'invoice total VAT');
    }
    if (expected.totals.gross !== undefined) {
      assertMoneyEqual(expected.totals.gross, actual.totals.gross, currency, 'invoice total gross');
    }
  }
}

function norm(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}
