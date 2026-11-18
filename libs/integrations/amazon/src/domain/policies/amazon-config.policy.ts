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
import type { AmazonConnectionConfig } from '../types/amazon-config.types';

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

  if (issues.length > 0 || region === null || environment === null) {
    return { ok: false, issues };
  }
  return { ok: true, config: { region, environment, marketplaceIds } };
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
