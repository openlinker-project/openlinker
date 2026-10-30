/**
 * Delivery on documents - UI helpers (#3908)
 *
 * Everything the editor needs that is NOT a mirrored core rule: the editable
 * form shape, the table-row model, suggestion matching, name checking and the
 * example-order arithmetic. The receipt-line wording itself comes from the
 * mirror (`delivery-line.ts`), so the preview and the document cannot diverge.
 *
 * A suggestion is a UI-only marker. Whether a row "still equals the
 * suggestion" is derived by comparing against it, never persisted.
 *
 * @module apps/web/src/features/delivery-on-documents/lib
 */
import { ISO_3166_1_COUNTRIES } from '../../../shared/lib/iso-3166-1-countries';
import type {
  DeliveryCountryExampleLine,
  DeliveryLineSuggestion,
} from '../api/delivery-on-documents.types';
import {
  DEFAULT_DELIVERY_LINE_NAME,
  formatReceiptLineName,
  maxDeliveryLineNameLength,
  type DeliveryLineRateFormat,
  type DeliveryLineRateMode,
  type DeliveryLineSettings,
  type DeliveryOnDocumentsConfig,
} from './delivery-line';

/** The editable shape: every field present, `fixedRate` a plain string. */
export interface DeliveryFormSettings {
  name: string;
  rate: DeliveryLineRateMode;
  fixedRate: string;
  freeDelivery: 'omit' | 'show';
  rateFormat: DeliveryLineRateFormat;
  invoiceName: string | null;
  methodNames: Record<string, string>;
}

/** `country === null` is the "All other countries" row. */
export interface DeliveryRule {
  country: string | null;
  settings: DeliveryFormSettings;
}

export const GENERIC_NAMES = ['Shipping', 'Delivery', 'Postage', 'Carriage'] as const;

export function neutralSettings(): DeliveryFormSettings {
  return {
    name: DEFAULT_DELIVERY_LINE_NAME,
    rate: 'goods',
    fixedRate: '',
    freeDelivery: 'omit',
    rateFormat: 'plain',
    invoiceName: null,
    methodNames: {},
  };
}

export function settingsFromSuggestion(suggestion: DeliveryLineSuggestion): DeliveryFormSettings {
  return {
    ...neutralSettings(),
    name: suggestion.defaultName,
    rate: suggestion.rateMode,
    freeDelivery: suggestion.omitFreeDelivery ? 'omit' : 'show',
  };
}

/** True while the row is exactly what the suggestion fills in. */
export function stillEqualsSuggestion(
  settings: DeliveryFormSettings,
  suggestion: DeliveryLineSuggestion,
): boolean {
  const target = settingsFromSuggestion(suggestion);
  return (
    settings.name === target.name &&
    settings.rate === target.rate &&
    settings.freeDelivery === target.freeDelivery &&
    settings.invoiceName === null &&
    settings.rateFormat === 'plain' &&
    Object.keys(settings.methodNames).length === 0
  );
}

function toFormSettings(stored: DeliveryLineSettings): DeliveryFormSettings {
  return {
    name: stored.name,
    rate: stored.rate,
    fixedRate: stored.fixedRate ?? '',
    freeDelivery: stored.freeDelivery,
    rateFormat: stored.rateFormat,
    invoiceName: stored.invoiceName ?? null,
    methodNames: { ...(stored.methodNames ?? {}) },
  };
}

/** Stored shape: optional fields are left out rather than written as blanks. */
export function toStoredSettings(form: DeliveryFormSettings): DeliveryLineSettings {
  const stored: DeliveryLineSettings = {
    name: form.name,
    rate: form.rate,
    freeDelivery: form.freeDelivery,
    rateFormat: form.rateFormat,
  };
  if (form.rate === 'fixed') stored.fixedRate = form.fixedRate;
  if (form.invoiceName !== null) stored.invoiceName = form.invoiceName;
  if (Object.keys(form.methodNames).length > 0) stored.methodNames = { ...form.methodNames };
  return stored;
}

/**
 * Table rows from config: countries first, then the "All other countries"
 * row, which always exists (it shows the OpenLinker default until the operator
 * saves one).
 */
export function rulesFromConfig(config: DeliveryOnDocumentsConfig | null): DeliveryRule[] {
  const countries = Object.entries(config?.countries ?? {})
    .map(([country, settings]) => ({ country, settings: toFormSettings(settings) }))
    .sort((a, b) => countryName(a.country).localeCompare(countryName(b.country)));
  const other = config?.default ? toFormSettings(config.default) : neutralSettings();
  return [...countries, { country: null, settings: other }];
}

/** Inverse of {@link rulesFromConfig}; `null` when nothing is configured. */
export function configFromRules(rules: readonly DeliveryRule[]): DeliveryOnDocumentsConfig | null {
  const countries: Record<string, DeliveryLineSettings> = {};
  let fallback: DeliveryLineSettings | undefined;
  for (const rule of rules) {
    if (rule.country === null) fallback = toStoredSettings(rule.settings);
    else countries[rule.country] = toStoredSettings(rule.settings);
  }
  if (fallback === undefined && Object.keys(countries).length === 0) return null;
  const config: DeliveryOnDocumentsConfig = { countries };
  if (fallback !== undefined) config.default = fallback;
  return config;
}

const COUNTRY_NAMES: ReadonlyMap<string, string> = new Map(
  ISO_3166_1_COUNTRIES.map((c) => [c.code, c.name]),
);

export function countryName(code: string): string {
  return COUNTRY_NAMES.get(code) ?? code;
}

export const rateLabel = (rate: string): string =>
  /^\d+([.,]\d+)?$/.test(rate) ? `${rate}%` : rate;

export function rateText(settings: DeliveryFormSettings): string {
  if (settings.rate === 'goods') return 'Same as the products';
  if (settings.rate === 'fixed') {
    return settings.fixedRate ? `Always ${rateLabel(settings.fixedRate)}` : 'Fixed, not set';
  }
  return 'Added to product prices';
}

export function receiptName(settings: DeliveryFormSettings, rate: string): string {
  return formatReceiptLineName(settings.name, rate, settings.rateFormat);
}

export const maxName = (format: DeliveryLineRateFormat): number =>
  maxDeliveryLineNameLength(format);

export function checkName(
  raw: string,
  format: DeliveryLineRateFormat,
): { name: string; error: string | null } {
  const name = raw.replace(/\s+/g, ' ').trim();
  if (!name) return { name, error: 'Enter a name.' };
  if (name.length > maxName(format)) {
    return {
      name,
      error: `Use at most ${maxName(format)} characters, so the VAT rate still fits in what fiscal printers read.`,
    };
  }
  if (/\d+([.,]\d+)?\s*%/.test(name)) {
    return { name, error: 'Leave the VAT rate out. Receipts add it for you.' };
  }
  return { name, error: null };
}

const LOCALE_BY_COUNTRY: Record<string, string> = {
  PL: 'pl-PL',
  CZ: 'cs-CZ',
  HU: 'hu-HU',
  SK: 'sk-SK',
};

/** The amount in the country's own currency; a bare number when the currency is unknown. */
export function formatMoney(amount: number, country: string, currency: string | null): string {
  if (!currency) return amount.toFixed(2);
  return new Intl.NumberFormat(LOCALE_BY_COUNTRY[country] ?? 'en-GB', {
    style: 'currency',
    currency,
  }).format(amount);
}

/**
 * Delivery cut across the example order's VAT rates in proportion to value.
 * Display only: the server owns the real allocation and the browser needs a
 * faithful picture, not the authority.
 */
export function splitByValue(
  delivery: number,
  lines: readonly DeliveryCountryExampleLine[],
): { rate: string; amount: number }[] {
  const groups = new Map<string, number>();
  for (const line of lines) {
    const key = line.rate ?? '';
    groups.set(key, (groups.get(key) ?? 0) + line.gross);
  }
  const total = [...groups.values()].reduce((a, b) => a + b, 0);
  if (groups.size === 0 || total <= 0) return [];
  const parts = [...groups.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([rate, gross]) => ({
      rate,
      amount: Math.floor((delivery * gross * 100) / total) / 100,
    }));
  const rest = Math.round((delivery - parts.reduce((a, p) => a + p.amount, 0)) * 100) / 100;
  parts[0].amount = Math.round((parts[0].amount + rest) * 100) / 100;
  return parts;
}
