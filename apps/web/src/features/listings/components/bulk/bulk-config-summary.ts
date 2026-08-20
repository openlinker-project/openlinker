/**
 * Bulk wizard config summary (#2227)
 *
 * Pure formatters that turn a committed `BulkWizardConfig` into (a) the list of
 * settings the operator moved away from their defaults - the only config the
 * destination bar shows without being asked - and (b) the full label/value rows
 * behind its disclosure.
 *
 * Kept React-free so the branches can be pinned by a plain unit test.
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import type { BulkWizardConfig, PricingPolicy, StockPolicy } from './bulk-wizard.types';

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

export type ConnectionEnvironment = 'sandbox' | 'production';

/**
 * `Connection.config` is an untyped `Record<string, unknown>`, so the
 * environment is narrowed rather than cast - and an absent or unrecognised
 * value returns `null` so the bar can omit the badge instead of guessing an
 * environment the operator would act on.
 */
export function readConnectionEnvironment(
  config: Record<string, unknown> | undefined,
): ConnectionEnvironment | null {
  const value = config?.environment;
  return value === 'sandbox' || value === 'production' ? value : null;
}

/** Signed percent, so a negative markup reads as a discount rather than `+-5%`. */
function formatPercent(percent: number): string {
  return `${percent > 0 ? '+' : ''}${percent}%`;
}

export function describePricingPolicy(policy: PricingPolicy, currency: string): string {
  switch (policy.mode) {
    case 'markup':
      return `Master price ${formatPercent(policy.percent)}`;
    case 'flat':
      return `Flat ${policy.amount.toFixed(2)} ${currency}`;
    default:
      return 'Master price';
  }
}

export function describeStockPolicy(policy: StockPolicy): string {
  switch (policy.mode) {
    case 'cap':
      return `Master stock, capped at ${policy.value}`;
    case 'flat':
      return `Flat ${policy.value}`;
    default:
      return 'Master stock';
  }
}

/**
 * Everything the operator moved off its default. An all-defaults batch returns
 * an empty list, which is what lets the bar render no chip at all rather than a
 * chip saying nothing changed.
 */
export function collectBulkConfigChanges(config: BulkWizardConfig): BulkConfigChange[] {
  const changes: BulkConfigChange[] = [];
  if (config.pricingPolicy.mode !== 'use-master') {
    changes.push({ label: 'Price', value: describePricingPolicy(config.pricingPolicy, config.currency) });
  }
  if (config.stockPolicy.mode !== 'use-master') {
    changes.push({ label: 'Stock', value: describeStockPolicy(config.stockPolicy) });
  }
  if (!config.publishImmediately) {
    changes.push({ label: 'On create', value: 'Save as draft' });
  }
  if (config.generateDescription) {
    changes.push({ label: 'Description', value: 'Written by AI' });
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
  if (value === null || value === undefined || value === '') return 'Not set';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.length === 0 ? 'Not set' : value.map((entry) => formatPlatformParamValue(entry)).join(', ');
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
  const rows: BulkConfigRow[] = [
    { id: 'currency', label: 'Listing currency', value: config.currency },
    { id: 'price', label: 'Price', value: describePricingPolicy(config.pricingPolicy, config.currency) },
    { id: 'stock', label: 'Stock', value: describeStockPolicy(config.stockPolicy) },
    {
      id: 'on-create',
      label: 'On create',
      value: config.publishImmediately ? 'Publish immediately' : 'Save as draft',
    },
    {
      id: 'description',
      label: 'Description',
      value: config.generateDescription ? 'Written by AI' : 'From the master catalogue',
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

  rows.push({ id: 'platform', label: 'Integration', value: `${platformLabel} (${platformType})` });
  rows.push({ id: 'connection-id', label: 'Connection id', value: connectionIdLabel, mono: true });

  return rows;
}
