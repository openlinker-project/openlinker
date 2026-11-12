/**
 * Shopify Config Policy
 *
 * Parses and normalises a connection's `config` blob. One function serves
 * the shape validator, the connection tester, the OAuth adapter and the
 * client builder, so they cannot disagree about what a valid Shopify
 * connection is.
 *
 * The store domain must be the permanent `*.myshopify.com` host: the Admin
 * API and the token endpoint live only there, and a custom storefront domain
 * would redirect (the client follows no redirects, so as not to replay the
 * token). The API version must be one the plugin's queries were verified
 * against (K06: a well-formed but unknown version used to be accepted and
 * failed only at the first call).
 *
 * @module libs/integrations/shopify/src/domain/policies
 */
import { SHOPIFY_DEFAULT_API_VERSION, SHOPIFY_SUPPORTED_API_VERSIONS } from '../../shopify.constants';
import type { ShopifyResolvedConfig } from '../types/shopify-config.types';
import { toShopifyGid } from './shopify-gid.policy';

/** Anchored at both ends, as Shopify's own guidance requires, so a lookalike host cannot pass. */
export const SHOPIFY_STORE_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const LOCATION_ID = /^(gid:\/\/shopify\/Location\/)?\d+$/;
const ISO2_COUNTRY = /^[A-Z]{2}$/;

export interface ShopifyConfigIssue {
  readonly path: string;
  readonly message: string;
}

export type ShopifyConfigParseResult =
  | { readonly ok: true; readonly config: ShopifyResolvedConfig }
  | { readonly ok: false; readonly issues: readonly ShopifyConfigIssue[] };

/** Lower-cases and strips a scheme and trailing slashes; `''` for a non-string. */
export function normaliseShopifyStoreDomain(raw: unknown): string {
  return typeof raw === 'string'
    ? raw
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/\/+$/, '')
    : '';
}

export function isShopifyStoreDomain(domain: string): boolean {
  return SHOPIFY_STORE_DOMAIN_PATTERN.test(domain);
}

function isSupportedApiVersion(value: string): boolean {
  return (SHOPIFY_SUPPORTED_API_VERSIONS as readonly string[]).includes(value);
}

function present(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

export function parseShopifyConfig(
  raw: Record<string, unknown> | null | undefined,
): ShopifyConfigParseResult {
  const config = raw ?? {};
  const issues: ShopifyConfigIssue[] = [];

  const storeDomain = normaliseShopifyStoreDomain(config.storeDomain);
  if (!isShopifyStoreDomain(storeDomain)) {
    issues.push({
      path: 'storeDomain',
      message: 'must be the shop\'s permanent domain, e.g. "my-shop.myshopify.com"',
    });
  }

  let apiVersion: string = SHOPIFY_DEFAULT_API_VERSION;
  if (present(config.apiVersion)) {
    const version = typeof config.apiVersion === 'string' ? config.apiVersion.trim() : '';
    if (!isSupportedApiVersion(version)) {
      issues.push({
        path: 'apiVersion',
        message: `must be one of the supported Admin API versions: ${SHOPIFY_SUPPORTED_API_VERSIONS.join(', ')}`,
      });
    } else {
      apiVersion = version;
    }
  }

  let locationGid: string | null = null;
  if (present(config.locationId)) {
    const text =
      typeof config.locationId === 'number' ? String(config.locationId) : config.locationId;
    if (typeof text !== 'string' || !LOCATION_ID.test(text.trim())) {
      issues.push({
        path: 'locationId',
        message: 'must be a Shopify Location id or GID (gid://shopify/Location/123)',
      });
    } else {
      locationGid = toShopifyGid('Location', text.trim());
    }
  }

  let unmanagedStockQuantity: number | null = null;
  if (present(config.unmanagedStockQuantity)) {
    const value = config.unmanagedStockQuantity;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      issues.push({ path: 'unmanagedStockQuantity', message: 'must be a whole number, 0 or more' });
    } else {
      unmanagedStockQuantity = value;
    }
  }

  let salesCountryIso2: string | null = null;
  if (present(config.salesCountryIso2)) {
    const value = config.salesCountryIso2;
    if (typeof value !== 'string' || !ISO2_COUNTRY.test(value.trim())) {
      issues.push({
        path: 'salesCountryIso2',
        message: 'must be a 2-letter uppercase ISO 3166-1 country code, e.g. PL',
      });
    } else {
      salesCountryIso2 = value.trim();
    }
  }

  let refundsThroughShopify = false;
  if (present(config.refundsThroughShopify)) {
    if (typeof config.refundsThroughShopify !== 'boolean') {
      issues.push({ path: 'refundsThroughShopify', message: 'must be true or false' });
    } else {
      refundsThroughShopify = config.refundsThroughShopify;
    }
  }

  return issues.length > 0
    ? { ok: false, issues }
    : {
        ok: true,
        config: {
          storeDomain,
          apiVersion,
          locationGid,
          unmanagedStockQuantity,
          salesCountryIso2,
          refundsThroughShopify,
        },
      };
}

/** The store's handle (`my-shop` of `my-shop.myshopify.com`), as the admin URLs name it. */
export function shopifyStoreHandle(storeDomain: string): string {
  return storeDomain.replace(/\.myshopify\.com$/, '');
}
