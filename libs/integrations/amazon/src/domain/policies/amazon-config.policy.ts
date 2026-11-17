/**
 * Amazon Config Policy
 *
 * The one reader of `Connection.config` for Amazon. The shape validator, the
 * adapter factory and the connection tester all go through `parseAmazonConfig`,
 * so what a save accepts is exactly what a job can use.
 *
 * Rules:
 *   - `region` defaults to `eu` (FR / DE / PL); any other value is refused.
 *   - `environment` defaults to `production`; `sandbox` points at Amazon's
 *     static sandbox, which answers from canned fixtures (#2881).
 *   - `marketplaceIds` must be a non-empty list of SP-API marketplace ids.
 *     An id we know (`AMAZON_KNOWN_MARKETPLACES`) must belong to the chosen
 *     region; an unknown id is accepted by format alone. Duplicates are dropped.
 *
 * @module libs/integrations/amazon/src/domain/policies
 */
import type { FlatValidationIssue } from '@openlinker/core/integrations';

import {
  AMAZON_DEFAULT_REGION,
  AMAZON_KNOWN_MARKETPLACES,
  AMAZON_SPAPI_HOSTS,
  AmazonEnvironmentValues,
  AmazonRegionValues,
  type AmazonRegion,
} from '../../amazon.constants';
import type { AmazonConnectionConfig, AmazonNotificationQueue } from '../types/amazon-config.types';

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
  return ids;
}

/** Merchant tokens are upper-case letters and digits (`A2EXAMPLE12345`). */
const SELLER_ID_PATTERN = /^[A-Z0-9]{8,20}$/;

function readSellerId(value: unknown, issues: FlatValidationIssue[]): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string' || !SELLER_ID_PATTERN.test(value.trim())) {
    issues.push({ path: 'sellerId', message: 'must be the merchant token from Seller Central, such as A2EXAMPLE12345' });
    return undefined;
  }
  return value.trim();
}
