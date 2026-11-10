/**
 * Delivery Line (#3905, ADR-082)
 *
 * What the delivery line on a sales document is called, which tax rate it
 * carries and whether it is shown at all. Settings live on the ORDER-SOURCE
 * connection (`config.deliveryOnDocuments`) and are chosen by the buyer's
 * delivery country, because the tax treatment of delivery is a per-country
 * legal matter that core must not encode (ADR-026). Core holds the resolver and
 * knows no country: a country is only ever a key the operator typed.
 *
 * Pure and import-free: no I/O, no framework, no regime knowledge. It lives in
 * `sales-documents` because BOTH document contexts need one answer and a fiscal
 * receipt is not an invoice (ADR-041), so neither could own it for the other.
 * Mirrors the `readPricingRule` config-coercion precedent: operator-editable
 * JSONB is read defensively, malformed entries are dropped and nothing throws.
 *
 * @module libs/core/src/sales-documents/domain/types
 * @see docs/architecture/adrs/082-delivery-line-on-sales-documents.md
 */

/** Config key on the order-source `Connection.config`. */
export const DELIVERY_ON_DOCUMENTS_CONFIG_KEY = 'deliveryOnDocuments';

/**
 * How the delivery line's tax rate is decided.
 *
 * - `goods`: follows the basket, split in proportion to gross (ADR-063 § 5).
 * - `fixed`: one line at the operator's `fixedRate`, no split.
 * - `spread`: no delivery line; the amount is folded into the product lines.
 */
export const DeliveryLineRateModeValues = ['goods', 'fixed', 'spread'] as const;
export type DeliveryLineRateMode = (typeof DeliveryLineRateModeValues)[number];

/** Whether a free delivery prints a zero line (invoices only, ADR-082 decision 7). */
export const DeliveryLineFreeModeValues = ['omit', 'show'] as const;
export type DeliveryLineFreeMode = (typeof DeliveryLineFreeModeValues)[number];

/**
 * How a receipt line name carries its rate: `Name 23%`, `Name (23%)`, or
 * `Name <label> 23%` where the operator supplies the label (`rateLabel`). The
 * label is data, never a word core knows: tax names differ by country.
 */
export const DeliveryLineRateFormatValues = ['plain', 'brackets', 'labelled'] as const;
export type DeliveryLineRateFormat = (typeof DeliveryLineRateFormatValues)[number];

/** One row of settings, as the operator authored it. */
export interface DeliveryLineSettings {
  name: string;
  rate: DeliveryLineRateMode;
  /** Percent as a decimal string, e.g. `'23'`. Required when `rate` is `fixed`. */
  fixedRate?: string;
  freeDelivery: DeliveryLineFreeMode;
  rateFormat: DeliveryLineRateFormat;
  /** The word printed before the rate in `labelled` format. Required for it. */
  rateLabel?: string;
  /** Invoice wording; the invoice never carries a rate suffix. Falls back to `name`. */
  invoiceName?: string | null;
  /** Per delivery-method names, keyed by `order.shipping.methodId`. */
  methodNames?: Record<string, string>;
}

/** The whole `config.deliveryOnDocuments` value. */
export interface DeliveryOnDocumentsConfig {
  default?: DeliveryLineSettings;
  /** Keyed by upper-case ISO-3166 alpha-2 country code. */
  countries: Record<string, DeliveryLineSettings>;
}

/** The answer for one order: what a document composer actually uses. */
export interface ResolvedDeliveryLine {
  /** The name before any rate suffix (receipts add one, see {@link formatReceiptLineName}). */
  name: string;
  /** The name an invoice carries, never suffixed. */
  invoiceName: string;
  rate: DeliveryLineRateMode;
  fixedRate?: string;
  freeDelivery: DeliveryLineFreeMode;
  rateFormat: DeliveryLineRateFormat;
  rateLabel?: string;
}

/** Name used when neither configuration nor the legacy key names the line. */
export const DEFAULT_DELIVERY_LINE_NAME = 'Shipping';

/**
 * How many characters of a receipt line name - rate suffix included - the
 * registering mechanism behind a fiscalization connection compares.
 *
 * Declared BY the adapter (the ADR-046 shape), never known by core: the number
 * is a property of a regime and its devices, so core only reads what an
 * adapter states and combines the answers with {@link combineReceiptLineNameLimits}.
 */
export interface ReceiptLineNameLimit {
  maxLength: number;
  /**
   * `false` when no connected adapter declared a budget and
   * {@link FALLBACK_RECEIPT_LINE_NAME_LENGTH} applies, so a surface can say
   * the number is a default rather than a fact about the operator's setup.
   */
  declared: boolean;
}

/**
 * The budget used when no connected fiscalization adapter declares one.
 *
 * A conservative default, not a regime fact: it equals the shortest budget any
 * adapter in this repository declares, so a name accepted under it is accepted
 * by every one of them. An adapter with a shorter budget declares it, and the
 * shorter number wins. Kept as a fallback rather than "no limit" because the
 * name is authored before any fiscalization connection may exist, and a name
 * that later turns out too long fails on a paid order, not in the editor.
 */
export const FALLBACK_RECEIPT_LINE_NAME_LENGTH = 40;

/**
 * Characters the rate suffix takes for an ordinary two-digit whole rate
 * (`23%`): ` 23%` = 4, ` (23%)` = 6, and ` 23%` plus the label and a space for
 * `labelled`. The budget is a fixed rule
 * rather than measured per order because the name is authored once, before any
 * order exists; a fractional rate (` 23.5%`) can exceed it, which is why the
 * formatter never truncates and the device-side check is the adapter's.
 */
const SUFFIX_RESERVE: Record<DeliveryLineRateFormat, number> = {
  plain: 4,
  brackets: 6,
  labelled: 4,
};

/**
 * The longest name an operator may author for a given suffix format: the
 * receipt budget less the suffix and, for `labelled`, the label and a space.
 */
export function maxDeliveryLineNameLength(
  format: DeliveryLineRateFormat,
  rateLabel?: string | null,
  receiptLineNameLength: number = FALLBACK_RECEIPT_LINE_NAME_LENGTH,
): number {
  const label = format === 'labelled' && typeof rateLabel === 'string' ? rateLabel.trim() : '';
  return receiptLineNameLength - SUFFIX_RESERVE[format] - (label === '' ? 0 : label.length + 1);
}

/**
 * Combine the budgets the connected fiscalization adapters declare into the
 * one an editor enforces.
 *
 * The SHORTEST wins: a delivery name is authored once on the order-source
 * connection and may be registered through any fiscalization connection, so
 * it must fit all of them. A declaration that is not a positive whole number is
 * ignored rather than trusted - an adapter bug must not shrink every name to
 * nothing. Nothing usable declared means the fallback, reported as undeclared.
 */
export function combineReceiptLineNameLimits(declared: readonly unknown[]): ReceiptLineNameLimit {
  const usable = declared.filter(
    (value): value is number =>
      typeof value === 'number' && Number.isInteger(value) && value > 0,
  );
  if (usable.length === 0) {
    return { maxLength: FALLBACK_RECEIPT_LINE_NAME_LENGTH, declared: false };
  }
  return { maxLength: Math.min(...usable), declared: true };
}

/**
 * Compose a receipt line name that states its rate.
 *
 * A fiscal device binds a name to one rate, so the name must change when the
 * rate does. A numeric code gets a percent sign (`23` -> `23%`); a non-numeric
 * one (`zw`, `np`) is printed as it is. A blank code returns the bare name -
 * an unknown rate must not be dressed up as one.
 */
export function formatReceiptLineName(
  name: string,
  rateCode: string | null | undefined,
  format: DeliveryLineRateFormat,
  rateLabel?: string | null,
): string {
  const code = typeof rateCode === 'string' ? rateCode.trim() : '';
  if (code === '') return name;
  // A source may spell 23% as '23.00' (Allegro); the device compares names, so
  // one rate must always produce one spelling.
  const rate = /^\d+(\.\d+)?$/.test(code) ? `${String(Number(code))}%` : code;
  switch (format) {
    case 'brackets':
      return `${name} (${rate})`;
    case 'labelled': {
      const label = typeof rateLabel === 'string' ? rateLabel.trim() : '';
      return label === '' ? `${name} ${rate}` : `${name} ${label} ${rate}`;
    }
    case 'plain':
    default:
      return `${name} ${rate}`;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMember<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

/** Upper-case, trimmed country key; `null` when it is not an ISO alpha-2 shape. */
function normaliseCountryKey(key: string): string | null {
  const normalised = key.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalised) ? normalised : null;
}

function isFixedRate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d+(\.\d+)?$/.test(value.trim())) return false;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 100;
}

/** Read one settings row; `null` when it is malformed (the whole row is dropped). */
function readSettings(value: unknown): DeliveryLineSettings | null {
  if (!isRecord(value)) return null;
  if (typeof value.name !== 'string' || value.name.trim() === '') return null;

  const rate = value.rate === undefined ? 'goods' : value.rate;
  if (!isMember(DeliveryLineRateModeValues, rate)) return null;
  const freeDelivery = value.freeDelivery === undefined ? 'omit' : value.freeDelivery;
  if (!isMember(DeliveryLineFreeModeValues, freeDelivery)) return null;
  const rateFormat = value.rateFormat === undefined ? 'plain' : value.rateFormat;
  if (!isMember(DeliveryLineRateFormatValues, rateFormat)) return null;

  const settings: DeliveryLineSettings = {
    name: value.name.trim(),
    rate,
    freeDelivery,
    rateFormat,
  };

  if (typeof value.rateLabel === 'string' && value.rateLabel.trim() !== '') {
    settings.rateLabel = value.rateLabel.trim();
  }

  if (rate === 'fixed') {
    // A fixed row without a usable rate would emit a rate-less line, which is
    // the very defect this feature exists to remove.
    if (!isFixedRate(value.fixedRate)) return null;
    settings.fixedRate = value.fixedRate.trim();
  }

  if (typeof value.invoiceName === 'string' && value.invoiceName.trim() !== '') {
    settings.invoiceName = value.invoiceName.trim();
  }

  if (isRecord(value.methodNames)) {
    const methodNames: Record<string, string> = {};
    for (const [methodId, methodName] of Object.entries(value.methodNames)) {
      if (typeof methodName === 'string' && methodName.trim() !== '') {
        methodNames[methodId] = methodName.trim();
      }
    }
    if (Object.keys(methodNames).length > 0) settings.methodNames = methodNames;
  }

  return settings;
}

/**
 * Read `config.deliveryOnDocuments` from a connection config.
 *
 * Never throws. A malformed row is dropped on its own (a bad Polish row must
 * not take the German one down with it); `null` means nothing usable is
 * configured, which callers treat as "behave as before".
 */
export function readDeliveryOnDocuments(config: unknown): DeliveryOnDocumentsConfig | null {
  if (!isRecord(config)) return null;
  const raw = config[DELIVERY_ON_DOCUMENTS_CONFIG_KEY];
  if (!isRecord(raw)) return null;

  const result: DeliveryOnDocumentsConfig = { countries: {} };
  const fallback = readSettings(raw.default);
  if (fallback !== null) result.default = fallback;

  if (isRecord(raw.countries)) {
    for (const [key, value] of Object.entries(raw.countries)) {
      const country = normaliseCountryKey(key);
      const settings = readSettings(value);
      if (country !== null && settings !== null) result.countries[country] = settings;
    }
  }

  if (result.default === undefined && Object.keys(result.countries).length === 0) return null;
  return result;
}

/** What identifies the order for resolution. */
export interface DeliveryLineResolutionInput {
  /** The buyer's delivery country, as the order carries it. */
  countryIso2?: string | null;
  /** `order.shipping.methodId`. */
  methodId?: string | null;
  /** `config.invoicing.shippingLineName` on the invoicing connection. */
  legacyName?: string;
}

/**
 * Resolve the delivery line for one order (ADR-082 decision 5).
 *
 * Row: the buyer's country row, else `default`. Name: that row's
 * `methodNames[methodId]`, else its `name`; with no row at all, the legacy
 * invoicing-connection name, else `Shipping`. A per-method name is looked up
 * in the SELECTED row only - a default row's method names would otherwise leak
 * into a country that has its own wording.
 */
export function resolveDeliveryLine(
  config: DeliveryOnDocumentsConfig | null,
  input: DeliveryLineResolutionInput,
): ResolvedDeliveryLine {
  const country =
    typeof input.countryIso2 === 'string' ? input.countryIso2.trim().toUpperCase() : '';
  const row =
    (country !== '' && config !== null ? config.countries[country] : undefined) ?? config?.default;

  if (row === undefined) {
    const legacy = input.legacyName?.trim();
    const name = legacy !== undefined && legacy !== '' ? legacy : DEFAULT_DELIVERY_LINE_NAME;
    return {
      name,
      invoiceName: name,
      rate: 'goods',
      freeDelivery: 'omit',
      rateFormat: 'plain',
    };
  }

  const methodId = input.methodId ?? null;
  const name = (methodId !== null ? row.methodNames?.[methodId] : undefined) ?? row.name;
  const resolved: ResolvedDeliveryLine = {
    name,
    invoiceName: row.invoiceName?.trim() || name,
    rate: row.rate,
    freeDelivery: row.freeDelivery,
    rateFormat: row.rateFormat,
  };
  if (row.fixedRate !== undefined) resolved.fixedRate = row.fixedRate;
  if (row.rateLabel !== undefined) resolved.rateLabel = row.rateLabel;
  return resolved;
}

export interface DeliveryConfigIssue {
  path: string;
  message: string;
}

function validateNameLength(
  name: string,
  format: DeliveryLineRateFormat,
  path: string,
  issues: DeliveryConfigIssue[],
  receiptLineNameLength: number,
  rateLabel?: string | null,
): void {
  if (name.trim() === '') {
    issues.push({ path, message: 'must not be blank' });
    return;
  }
  const max = maxDeliveryLineNameLength(format, rateLabel, receiptLineNameLength);
  if (name.trim().length > max) {
    issues.push({
      path,
      message: `must be at most ${max} characters so the name plus its rate fits ${receiptLineNameLength}`,
    });
  }
  if (/\d\s*%/.test(name)) {
    issues.push({
      path,
      message:
        'must not contain a percentage; the rate is added to receipt names automatically',
    });
  }
}

function validateSettings(
  value: unknown,
  path: string,
  issues: DeliveryConfigIssue[],
  receiptLineNameLength: number,
): void {
  if (!isRecord(value)) {
    issues.push({ path, message: 'must be an object' });
    return;
  }

  let format: DeliveryLineRateFormat = 'plain';
  if (value.rateFormat !== undefined) {
    if (isMember(DeliveryLineRateFormatValues, value.rateFormat)) {
      format = value.rateFormat;
    } else {
      issues.push({
        path: `${path}.rateFormat`,
        message: `must be one of ${DeliveryLineRateFormatValues.join(', ')}`,
      });
    }
  }

  const rateLabel = typeof value.rateLabel === 'string' ? value.rateLabel : undefined;
  if (format === 'labelled') {
    const label = rateLabel?.trim() ?? '';
    if (label === '' || label.length > 8 || /[\d%]/.test(label)) {
      issues.push({
        path: `${path}.rateLabel`,
        message: 'is required for the labelled format: 1-8 characters, no digits or %',
      });
    }
  }

  if (typeof value.name !== 'string') {
    issues.push({ path: `${path}.name`, message: 'is required and must be a string' });
  } else {
    validateNameLength(
      value.name,
      format,
      `${path}.name`,
      issues,
      receiptLineNameLength,
      rateLabel,
    );
  }

  let rate: DeliveryLineRateMode = 'goods';
  if (value.rate !== undefined) {
    if (isMember(DeliveryLineRateModeValues, value.rate)) {
      rate = value.rate;
    } else {
      issues.push({
        path: `${path}.rate`,
        message: `must be one of ${DeliveryLineRateModeValues.join(', ')}`,
      });
    }
  }

  if (rate === 'fixed' && !isFixedRate(value.fixedRate)) {
    issues.push({
      path: `${path}.fixedRate`,
      message: 'is required for a fixed rate and must be a number between 0 and 100',
    });
  } else if (value.fixedRate !== undefined && !isFixedRate(value.fixedRate)) {
    issues.push({ path: `${path}.fixedRate`, message: 'must be a number between 0 and 100' });
  }

  if (
    value.freeDelivery !== undefined &&
    !isMember(DeliveryLineFreeModeValues, value.freeDelivery)
  ) {
    issues.push({
      path: `${path}.freeDelivery`,
      message: `must be one of ${DeliveryLineFreeModeValues.join(', ')}`,
    });
  }

  if (value.invoiceName !== undefined && value.invoiceName !== null) {
    if (typeof value.invoiceName !== 'string' || value.invoiceName.trim() === '') {
      issues.push({ path: `${path}.invoiceName`, message: 'must be a non-blank string' });
    }
  }

  if (value.methodNames !== undefined) {
    if (!isRecord(value.methodNames)) {
      issues.push({ path: `${path}.methodNames`, message: 'must be an object' });
    } else {
      for (const [methodId, methodName] of Object.entries(value.methodNames)) {
        const methodPath = `${path}.methodNames.${methodId}`;
        if (typeof methodName !== 'string') {
          issues.push({ path: methodPath, message: 'must be a string' });
        } else {
          validateNameLength(
            methodName,
            format,
            methodPath,
            issues,
            receiptLineNameLength,
            rateLabel,
          );
        }
      }
    }
  }
}

/**
 * Validate an operator-authored `deliveryOnDocuments` value for the write path.
 *
 * The reader above is deliberately forgiving (a stored value must never break
 * an issuance), so strictness lives here, where there is an operator to tell.
 * Returns every problem at once rather than the first.
 *
 * `receiptLineNameLength` is the budget the connected fiscalization adapters
 * declare (see {@link combineReceiptLineNameLimits}); a caller with no adapter
 * to ask gets the conservative fallback.
 */
export function validateDeliveryOnDocumentsShape(
  value: unknown,
  receiptLineNameLength: number = FALLBACK_RECEIPT_LINE_NAME_LENGTH,
): DeliveryConfigIssue[] {
  const issues: DeliveryConfigIssue[] = [];
  const root = DELIVERY_ON_DOCUMENTS_CONFIG_KEY;
  if (!isRecord(value)) {
    return [{ path: root, message: 'must be an object' }];
  }

  if (value.default !== undefined) {
    validateSettings(value.default, `${root}.default`, issues, receiptLineNameLength);
  }

  if (value.countries !== undefined) {
    if (!isRecord(value.countries)) {
      issues.push({ path: `${root}.countries`, message: 'must be an object' });
    } else {
      const seen = new Set<string>();
      for (const [key, row] of Object.entries(value.countries)) {
        const country = normaliseCountryKey(key);
        if (country === null) {
          issues.push({
            path: `${root}.countries.${key}`,
            message: 'country key must be a two-letter ISO 3166 code',
          });
          continue;
        }
        if (seen.has(country)) {
          issues.push({
            path: `${root}.countries.${key}`,
            message: `duplicates another entry for ${country}`,
          });
          continue;
        }
        seen.add(country);
        validateSettings(row, `${root}.countries.${country}`, issues, receiptLineNameLength);
      }
    }
  }
  return issues;
}

/** One product line, as the spread allocation sees it. */
export interface DeliverySpreadLine {
  unitPriceGross: number;
  quantity: number;
  /** A free item: never takes delivery, so its technical cent stays what it is. */
  isGift?: boolean;
}

/**
 * Fold a delivery amount into product lines (ADR-082 decision 6, `spread`).
 *
 * Works in integer minor units so the result sums EXACTLY to the delivery
 * amount. Each line's share is proportional to its gross; a line can only be
 * raised by a whole number of minor units per unit, so what a line's quantity
 * cannot divide is pooled and handed to a quantity-1 line (the largest one).
 *
 * Gift lines are left out of the allocation entirely (like `reconcileDiscountRounding`).
 *
 * Returns the per-unit increase for each input line, in major units, or `null`
 * when there is a remainder and no quantity-1 line to take it - the caller then
 * falls back to a separate delivery line rather than inventing a price.
 */
export function spreadDeliveryAcrossLines(
  shipping: number,
  lines: readonly DeliverySpreadLine[],
  minorUnitExponent: number,
): number[] | null {
  const factor = Math.pow(10, minorUnitExponent);
  const shippingMinor = Math.round((shipping + Number.EPSILON) * factor);
  if (!Number.isFinite(shippingMinor) || shippingMinor <= 0) return lines.map(() => 0);
  if (lines.length === 0) return null;

  const grosses = lines.map((line) =>
    line.isGift === true ? 0 : Math.max(0, line.unitPriceGross * line.quantity),
  );
  const totalGross = grosses.reduce((sum, gross) => sum + gross, 0);
  if (!(totalGross > 0)) return null;
  if (
    lines.some(
      (line) => line.isGift !== true && (!Number.isInteger(line.quantity) || line.quantity <= 0),
    )
  ) {
    return null;
  }

  const unitIncreaseMinor = lines.map((line, index) => {
    if (line.isGift === true) return 0;
    const share = Math.floor((shippingMinor * grosses[index]) / totalGross);
    return Math.floor(share / line.quantity);
  });
  const allocated = lines.reduce(
    (sum, line, index) => sum + unitIncreaseMinor[index] * line.quantity,
    0,
  );
  const remainder = shippingMinor - allocated;

  if (remainder > 0) {
    let target = -1;
    lines.forEach((line, index) => {
      if (
        line.isGift !== true &&
        line.quantity === 1 &&
        (target === -1 || grosses[index] > grosses[target])
      ) {
        target = index;
      }
    });
    if (target === -1) return null;
    unitIncreaseMinor[target] += remainder;
  }

  return unitIncreaseMinor.map((minor) => minor / factor);
}
