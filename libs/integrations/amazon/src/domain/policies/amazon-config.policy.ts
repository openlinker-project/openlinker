/**
 * Amazon Config Policy
 *
 * The one reader of `Connection.config` for Amazon. The shape validator, the
 * adapter factory and the connection tester all go through `parseAmazonConfig`,
 * so what a save accepts is exactly what a job can use.
 *
 * Rules:
 *   - `region` defaults to `eu`; a value outside `eu`, `na`, `fe` is refused.
 *   - `environment` defaults to `production`; `sandbox` points at Amazon's
 *     static sandbox, which answers from canned fixtures (#2881).
 *   - `fbaLocationId` (optional) needs `stockLocationOverride` set to a
 *     different location (#4183, see `readFbaLocationId`).
 *   - `refundsEnabled` (optional boolean, #4184) opts in to sending refunds.
 *   - `marketplaceIds` must be a non-empty list of SP-API marketplace ids.
 *     An id we know (`AMAZON_KNOWN_MARKETPLACES`) must belong to the chosen
 *     region; an unknown id is accepted by format alone. Duplicates are dropped.
 *   - A region without a unified seller account (`fe`) takes ONE marketplace.
 *     The rule is part of the parse, so the factory and the tester refuse such
 *     a config too, not only a save: a second marketplace there belongs to
 *     another seller account, so the connection could not read it anyway.
 *   - `catalogueMarketplaceId`, when set, must be one of `marketplaceIds`:
 *     the catalogue's price, currency and tax country come from it.
 *   - The region is fixed once the connection exists: another region is
 *     another seller account with its own refresh token and merchant token,
 *     so `regionChangeIssue` refuses a change on update. Another region is a
 *     new connection.
 *
 * @module libs/integrations/amazon/src/domain/policies
 */
import type { FlatValidationIssue } from '@openlinker/core/integrations';

import {
  AMAZON_DEFAULT_REGION,
  AMAZON_KNOWN_MARKETPLACES,
  AMAZON_SINGLE_MARKETPLACE_REGIONS,
  AMAZON_SPAPI_HOSTS,
  AmazonEnvironmentValues,
  AmazonRegionValues,
  type AmazonRegion,
} from '../../amazon.constants';
import type { AmazonConnectionConfig, AmazonNotificationQueue } from '../types/amazon-config.types';
import { canonicalTaxRateCode } from './amazon-tax-code.policy';

/** SP-API marketplace ids are 10-14 upper-case letters and digits (`A1PA6795UKMFR9`). */
const MARKETPLACE_ID_PATTERN = /^[A-Z0-9]{10,14}$/;

export type AmazonConfigParseResult =
  | { readonly ok: true; readonly config: AmazonConnectionConfig }
  | { readonly ok: false; readonly issues: readonly FlatValidationIssue[] };

export function parseAmazonConfig(raw: Record<string, unknown> | null | undefined): AmazonConfigParseResult {
  const config = raw ?? {};
  const issues: FlatValidationIssue[] = [];

  const region = readEnum(config.region, AmazonRegionValues, AMAZON_DEFAULT_REGION);
  if (region === null) {
    issues.push({ path: 'region', message: `must be one of: ${AmazonRegionValues.join(', ')}` });
  }

  const environment = readEnum(config.environment, AmazonEnvironmentValues, 'production');
  if (environment === null) {
    issues.push({ path: 'environment', message: `must be one of: ${AmazonEnvironmentValues.join(', ')}` });
  }

  const marketplaceIds = readMarketplaceIds(config.marketplaceIds, region, issues);
  const notificationQueue = readNotificationQueue(config.notificationQueueUrl, issues);
  const sellerId = readSellerId(config.sellerId, issues);
  const taxCodeRates = readTaxCodeRates(config.taxCodeRates, issues);
  const catalogueMarketplaceId = readCatalogueMarketplaceId(config.catalogueMarketplaceId, marketplaceIds, issues);
  const fbaLocationId = readFbaLocationId(config.fbaLocationId, config.stockLocationOverride, issues);
  const refundsEnabled = readOptionalBoolean(config.refundsEnabled, 'refundsEnabled', issues);

  if (issues.length > 0 || region === null || environment === null) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    config: {
      region,
      environment,
      marketplaceIds,
      ...(notificationQueue ? { notificationQueue } : {}),
      ...(sellerId ? { sellerId } : {}),
      ...(taxCodeRates ? { taxCodeRates } : {}),
      ...(catalogueMarketplaceId ? { catalogueMarketplaceId } : {}),
      ...(fbaLocationId ? { fbaLocationId } : {}),
      ...(refundsEnabled ? { refundsEnabled } : {}),
    },
  };
}

/** `https://sqs.{region}.amazonaws.com/{account}/{name}`, the form SQS shows a queue URL in. */
const SQS_QUEUE_URL_PATTERN = /^https:\/\/sqs\.([a-z0-9-]+)\.amazonaws\.com\/(\d{12})\/([A-Za-z0-9_-]{1,80}(?:\.fifo)?)$/;

/**
 * Optional `notificationQueueUrl` (#4179). Empty or absent means no queue; a
 * value that is not an SQS queue URL is refused, since the ARN Amazon needs
 * and the region the requests are signed for are both read from it.
 */
export function readNotificationQueue(
  value: unknown,
  issues: FlatValidationIssue[] = [],
): AmazonNotificationQueue | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const match = typeof value === 'string' ? SQS_QUEUE_URL_PATTERN.exec(value.trim()) : null;
  if (match === null) {
    issues.push({
      path: 'notificationQueueUrl',
      message: 'must be an SQS queue URL such as https://sqs.eu-west-1.amazonaws.com/123456789012/amazon-notifications',
    });
    return undefined;
  }
  const [, region, account, name] = match;
  return { url: (value as string).trim(), region, arn: `arn:aws:sqs:${region}:${account}:${name}` };
}

/**
 * The issue to raise when an update moves a connection to another region, or
 * null. Compared on the resolved region, so a stored config without `region`
 * reads as the default and an unrelated save does not trip it.
 */
export function regionChangeIssue(
  config: Record<string, unknown>,
  previous: Record<string, unknown>,
): FlatValidationIssue | null {
  const before = readEnum(previous.region, AmazonRegionValues, AMAZON_DEFAULT_REGION);
  const after = readEnum(config.region, AmazonRegionValues, AMAZON_DEFAULT_REGION);
  if (before === null || after === null || before === after) {
    return null;
  }
  return {
    path: 'region',
    message: `cannot change from ${before} to ${after}: another region is another seller account; create a new connection for it`,
  };
}

/** The SP-API host a connection talks to. */
export function resolveAmazonSpApiHost(config: Pick<AmazonConnectionConfig, 'region' | 'environment'>): string {
  return AMAZON_SPAPI_HOSTS[config.environment][config.region];
}

function readEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T | null {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function readMarketplaceIds(
  value: unknown,
  region: AmazonRegion | null,
  issues: FlatValidationIssue[],
): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push({ path: 'marketplaceIds', message: 'must list at least one Amazon marketplace id' });
    return [];
  }
  const ids: string[] = [];
  value.forEach((entry, index) => {
    const path = `marketplaceIds.${index}`;
    if (typeof entry !== 'string' || !MARKETPLACE_ID_PATTERN.test(entry.trim())) {
      issues.push({ path, message: 'must be an Amazon marketplace id such as A1PA6795UKMFR9' });
      return;
    }
    const id = entry.trim();
    const known = AMAZON_KNOWN_MARKETPLACES[id];
    if (known !== undefined && region !== null && known.region !== region) {
      issues.push({
        path,
        message: `marketplace ${id} (${known.country}) is served by the ${known.region} region, not ${region}`,
      });
      return;
    }
    if (!ids.includes(id)) {
      ids.push(id);
    }
  });
  if (region !== null && AMAZON_SINGLE_MARKETPLACE_REGIONS.includes(region) && ids.length > 1) {
    issues.push({
      path: 'marketplaceIds',
      message: `the ${region} region has a separate seller account per marketplace; choose one marketplace and create another connection for the next`,
    });
  }
  return ids;
}

/** Merchant tokens are upper-case letters and digits (`A2EXAMPLE12345`). */
const SELLER_ID_PATTERN = /^[A-Z0-9]{8,20}$/;

/** The merchant token (`sellerId`), or undefined when absent or not a merchant token. */
export function readSellerId(value: unknown, issues: FlatValidationIssue[] = []): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string' || !SELLER_ID_PATTERN.test(value.trim())) {
    issues.push({ path: 'sellerId', message: 'must be the merchant token from Seller Central, such as A2EXAMPLE12345' });
    return undefined;
  }
  return value.trim();
}

/** OpenLinker's VAT rate codes: a percentage or an exemption code (`zw`, `np`, `oo`). */
const TAX_RATE_CODE_PATTERN = /^(\d{1,2}(\.\d{1,2})?|zw|np|oo)$/i;

function readTaxCodeRates(value: unknown, issues: FlatValidationIssue[]): Record<string, string> | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    issues.push({ path: 'taxCodeRates', message: 'must map Amazon product tax codes to rates, such as {"A_GEN_STANDARD": "23"}' });
    return undefined;
  }
  const rates: Record<string, string> = {};
  for (const [code, rate] of Object.entries(value as Record<string, unknown>)) {
    if (typeof rate !== 'string' || !TAX_RATE_CODE_PATTERN.test(rate.trim())) {
      issues.push({ path: `taxCodeRates.${code}`, message: 'must be a rate such as "23", "8", "0" or "zw"' });
      continue;
    }
    // Stored in the one spelling the catalogue reports and the reverse lookup
    // compares: an upper-case Amazon code, a canonical OpenLinker rate code.
    rates[code.trim().toUpperCase()] = canonicalTaxRateCode(rate) as string;
  }
  return Object.keys(rates).length > 0 ? rates : undefined;
}

/** Optional `catalogueMarketplaceId`: empty means the first marketplace; any other value must be listed. */
function readCatalogueMarketplaceId(
  value: unknown,
  marketplaceIds: readonly string[],
  issues: FlatValidationIssue[],
): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string' || !marketplaceIds.includes(value.trim())) {
    issues.push({ path: 'catalogueMarketplaceId', message: 'must be one of the connection\'s marketplaceIds' });
    return undefined;
  }
  return value.trim();
}

/** The marketplace the catalogue is read from: the chosen one, else the first. */
export function resolveCatalogueMarketplaceId(
  config: Pick<AmazonConnectionConfig, 'marketplaceIds' | 'catalogueMarketplaceId'>,
): string {
  return config.catalogueMarketplaceId ?? config.marketplaceIds[0];
}

/** OpenLinker location ids (`ol_location_...`). */
const LOCATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * Optional `fbaLocationId` (#4183). FBA stock is reported at this location, so
 * the FBM stock of the same variant must be located too: core treats a variant
 * reported both without and with a location as a contradiction and retires the
 * pooled row (#2322). `stockLocationOverride` is the core field that locates
 * it; the two must differ, or both quantities would land on one position.
 */
function readFbaLocationId(
  value: unknown,
  stockLocationOverride: unknown,
  issues: FlatValidationIssue[],
): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string' || !LOCATION_ID_PATTERN.test(value.trim())) {
    issues.push({ path: 'fbaLocationId', message: 'must be an OpenLinker location id' });
    return undefined;
  }
  const id = value.trim();
  const fbmLocation = typeof stockLocationOverride === 'string' ? stockLocationOverride.trim() : '';
  if (fbmLocation === '') {
    issues.push({
      path: 'fbaLocationId',
      message: 'needs a stock location for the seller-fulfilled stock (stockLocationOverride) as well',
    });
    return undefined;
  }
  if (fbmLocation === id) {
    issues.push({
      path: 'fbaLocationId',
      message: 'must differ from the stock location of the seller-fulfilled stock (stockLocationOverride)',
    });
    return undefined;
  }
  return id;
}

function readOptionalBoolean(value: unknown, path: string, issues: FlatValidationIssue[]): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    issues.push({ path, message: 'must be true or false' });
    return undefined;
  }
  return value;
}
