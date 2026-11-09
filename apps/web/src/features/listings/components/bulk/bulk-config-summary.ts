/**
 * Bulk wizard config summary (#2227)
 *
 * Pure formatters that turn a committed `BulkWizardConfig` into (a) the list of
 * settings the operator moved away from their defaults - the only config the
 * destination bar shows without being asked - and (b) the full label/value rows
 * behind its disclosure.
 *
 * Kept React-free so the branches can be pinned by a plain unit test. Every
 * word reads the `listings.bulkConfigSummary` copy at call time, so the rows
 * follow the active language.
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import {
  getBcp47Locale,
  getLocale,
  getMessages,
  interpolate,
  type Messages,
  type ResolvedCopy,
} from '../../../../shared/i18n';
import type { BulkWizardConfig, PricingPolicy, StockPolicy } from './bulk-wizard.types';

function copy(): ResolvedCopy<Messages['listings']>['bulkConfigSummary'] {
  return getMessages('listings').bulkConfigSummary;
}

function numberFormat(options?: Intl.NumberFormatOptions): Intl.NumberFormat {
  return new Intl.NumberFormat(getBcp47Locale(getLocale()), options);
}

/** One label/value row rendered by `KeyValueList` in the bar's settings panel. */
export interface BulkConfigRow {
  id: string;
  label: string;
  value: string;
  mono?: boolean;
}

/** A setting the operator changed away from its default. */
export interface BulkConfigChange {
  label: string;
  value: string;
}

/** Signed percent, so a negative markup reads as a discount rather than `+-5%`. */
function formatPercent(percent: number): string {
  return numberFormat({ style: 'percent', signDisplay: 'exceptZero', maximumFractionDigits: 4 }).format(
    percent / 100,
  );
}

export function describePricingPolicy(policy: PricingPolicy, currency: string): string {
  const price = copy().price;
  switch (policy.mode) {
    case 'markup':
      return interpolate(price.masterWithMarkup, { percent: formatPercent(policy.percent) });
    case 'flat':
      return interpolate(price.flat, {
        amount: numberFormat({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(policy.amount),
        currency,
      });
    default:
      return price.master;
  }
}

export function describeStockPolicy(policy: StockPolicy): string {
  const stock = copy().stock;
  switch (policy.mode) {
    case 'cap':
      return interpolate(stock.capped, { value: numberFormat().format(policy.value) });
    case 'flat':
      return interpolate(stock.flat, { value: numberFormat().format(policy.value) });
    default:
      return stock.master;
  }
}

/**
 * Everything the operator moved off its default. An all-defaults batch returns
 * an empty list, which is what lets the bar render no chip at all rather than a
 * chip saying nothing changed.
 */
export function collectBulkConfigChanges(config: BulkWizardConfig): BulkConfigChange[] {
  const { labels, values } = copy();
  const changes: BulkConfigChange[] = [];
  if (config.pricingPolicy.mode !== 'use-master') {
    changes.push({ label: labels.price, value: describePricingPolicy(config.pricingPolicy, config.currency) });
  }
  if (config.stockPolicy.mode !== 'use-master') {
    changes.push({ label: labels.stock, value: describeStockPolicy(config.stockPolicy) });
  }
  if (!config.publishImmediately) {
    changes.push({ label: labels.onCreate, value: values.saveAsDraft });
  }
  if (config.generateDescription) {
    changes.push({ label: labels.description, value: values.writtenByAi });
  }
  return changes;
}

/**
 * `deliveryPolicyId` -> `Delivery policy`, so an open-world param key reads as a
 * label. The `Id` suffix is dropped: it names the shape of the value, which the
 * operator can already see, and every param key in the repo that carries it is
 * a reference to something the label already names.
 */
export function humanizeParamKey(key: string): string {
  const withoutIdSuffix = key.replace(/[_-]?(?:Id|ID|id)$/, '');
  const spaced = (withoutIdSuffix === '' ? key : withoutIdSuffix)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/**
 * A value the operator cannot read as words - a uuid, an internal id, an opaque
 * token. Rendered mono so it reads as a reference to quote in a ticket rather
 * than as a name.
 */
export function looksLikeIdentifier(value: string): boolean {
  if (/\s/.test(value)) return false;
  return /^ol_/.test(value) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(value) || value.length >= 20;
}

/**
 * `platformParams` is open-world (`Record<string, unknown>`), so every value
 * shape gets a readable form - an object must never reach the operator as
 * `[object Object]`.
 */
export function formatPlatformParamValue(value: unknown): string {
  const notSet = copy().values.notSet;
  if (value === null || value === undefined || value === '') return notSet;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.length === 0
      ? notSet
      : new Intl.ListFormat(getBcp47Locale(getLocale()), { type: 'unit' }).format(
          value.map((entry) => formatPlatformParamValue(entry)),
        );
  }
  return JSON.stringify(value);
}

export interface BulkConfigRowsInput {
  config: BulkWizardConfig;
  /** Registry-resolved platform display name (`resolvePlatformLabel`). */
  platformLabel: string;
  platformType: string;
  /** Already-shortened connection id (`shortenId`). */
  connectionIdLabel: string;
}

/** The full step-1 config, in the order an operator reads it. */
export function buildBulkConfigRows({
  config,
  platformLabel,
  platformType,
  connectionIdLabel,
}: BulkConfigRowsInput): BulkConfigRow[] {
  const { labels, values } = copy();
  const rows: BulkConfigRow[] = [
    { id: 'currency', label: labels.currency, value: config.currency },
    { id: 'price', label: labels.price, value: describePricingPolicy(config.pricingPolicy, config.currency) },
    { id: 'stock', label: labels.stock, value: describeStockPolicy(config.stockPolicy) },
    {
      id: 'on-create',
      label: labels.onCreate,
      value: config.publishImmediately ? values.publishImmediately : values.saveAsDraft,
    },
    {
      id: 'description',
      label: labels.description,
      value: config.generateDescription ? values.writtenByAi : values.fromMasterCatalogue,
    },
  ];

  for (const [key, value] of Object.entries(config.platformParams)) {
    const formatted = formatPlatformParamValue(value);
    rows.push({
      id: `param-${key}`,
      label: humanizeParamKey(key),
      value: formatted,
      ...(looksLikeIdentifier(formatted) ? { mono: true } : {}),
    });
  }

  rows.push({
    id: 'platform',
    label: labels.integration,
    value: interpolate(values.integration, { platform: platformLabel, platformType }),
  });
  rows.push({ id: 'connection-id', label: labels.connectionId, value: connectionIdLabel, mono: true });

  return rows;
}
