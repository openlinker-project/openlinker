/**
 * Delivery line - frontend mirror (#3905, ADR-079)
 *
 * Hand-maintained copy of the pure resolver in
 * `libs/core/src/sales-documents/domain/types/delivery-line.types.ts`. The
 * browser bundle does not depend on `@openlinker/core` (#591), so the settings
 * form previews a receipt line name with this copy. A preview computed by
 * different code than the document is worse than none, so
 * `scripts/check-delivery-line-mirror.mjs` (under `pnpm check:invariants`)
 * fails the build when a mirrored declaration drifts. Edit core first, then
 * paste here. Comments and formatting are free; the code is not.
 *
 * The write-path validator and the spread allocation are deliberately NOT
 * mirrored: the server is the authority for both and the browser needs
 * neither.
 */

/** Config key on the order-source `Connection.config`. */
export const DELIVERY_ON_DOCUMENTS_CONFIG_KEY = 'deliveryOnDocuments';

/**
 * How the delivery line's VAT rate is decided.
 *
 * - `goods`: follows the basket, split in proportion to gross (ADR-063 § 5).
 * - `fixed`: one line at the operator's `fixedRate`, no split.
 * - `spread`: no delivery line; the amount is folded into the product lines.
 */
export const DeliveryLineRateModeValues = ['goods', 'fixed', 'spread'] as const;
export type DeliveryLineRateMode = (typeof DeliveryLineRateModeValues)[number];

/** Whether a free delivery prints a zero line (invoices only, ADR-079 decision 7). */
export const DeliveryLineFreeModeValues = ['omit', 'show'] as const;
export type DeliveryLineFreeMode = (typeof DeliveryLineFreeModeValues)[number];

/** How a receipt line name carries its rate: `Name 23%`, `Name (23%)`, `Name VAT 23%`. */
export const DeliveryLineRateFormatValues = ['plain', 'brackets', 'vat'] as const;
export type DeliveryLineRateFormat = (typeof DeliveryLineRateFormatValues)[number];

/** One row of settings, as the operator authored it. */
export interface DeliveryLineSettings {
  name: string;
  rate: DeliveryLineRateMode;
  /** Percent as a decimal string, e.g. `'23'`. Required when `rate` is `fixed`. */
  fixedRate?: string;
  freeDelivery: DeliveryLineFreeMode;
  rateFormat: DeliveryLineRateFormat;
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
}

/** Name used when neither configuration nor the legacy key names the line. */
export const DEFAULT_DELIVERY_LINE_NAME = 'Shipping';

/**
 * The most characters a fiscal printer compares in a line name (Dz.U. 2024
 * poz. 1654). The limit applies to the name WITH its rate suffix.
 */
export const MAX_RECEIPT_LINE_NAME = 40;

/**
 * Characters the rate suffix takes for an ordinary two-digit whole rate
 * (`23%`): ` 23%` = 4, ` (23%)` = 6, ` VAT 23%` = 8. The budget is a fixed rule
 * rather than measured per order because the name is authored once, before any
 * order exists; a fractional rate (` 23.5%`) can exceed it, which is why the
 * formatter never truncates and the printer-side check is the adapter's.
 */
const SUFFIX_RESERVE: Record<DeliveryLineRateFormat, number> = {
  plain: 4,
  brackets: 6,
  vat: 8,
};

/** The longest name an operator may author for a given suffix format (36 / 34 / 32). */
export function maxDeliveryLineNameLength(format: DeliveryLineRateFormat): number {
  return MAX_RECEIPT_LINE_NAME - SUFFIX_RESERVE[format];
}

/**
 * Compose a receipt line name that states its rate.
 *
 * A fiscal printer binds a name to one rate, so the name must change when the
 * rate does. A numeric code gets a percent sign (`23` -> `23%`); a non-numeric
 * one (`zw`, `np`) is printed as it is. A blank code returns the bare name -
 * an unknown rate must not be dressed up as one.
 */
export function formatReceiptLineName(
  name: string,
  rateCode: string | null | undefined,
  format: DeliveryLineRateFormat,
): string {
  const code = typeof rateCode === 'string' ? rateCode.trim() : '';
  if (code === '') return name;
  // A source may spell 23% as '23.00' (Allegro); the printer compares names, so
  // one rate must always produce one spelling.
  const rate = /^\d+(\.\d+)?$/.test(code) ? `${String(Number(code))}%` : code;
  switch (format) {
    case 'brackets':
      return `${name} (${rate})`;
    case 'vat':
      return `${name} VAT ${rate}`;
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
 * Resolve the delivery line for one order (ADR-079 decision 5).
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
  return resolved;
}
