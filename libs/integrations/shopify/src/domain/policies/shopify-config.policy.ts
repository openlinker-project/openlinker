/**
 * Shopify Config Policy
 *
 * Parses and normalises a connection's `config` blob. One function serves the
 * shape validator, the connection tester and the adapter factory, so the three
 * cannot disagree about what a valid Shopify connection is.
 *
 * The store domain must be the permanent `*.myshopify.com` host: the Admin API
 * and the token endpoint live only there, and a custom storefront domain would
 * redirect (and the client follows no redirects, so as not to replay the token).
 *
 * @module libs/integrations/shopify/src/domain/policies
 */
import { SHOPIFY_DEFAULT_API_VERSION } from '../../shopify.constants';
import type { ShopifyResolvedConfig } from '../types/shopify-config.types';
import { toShopifyGid } from './shopify-gid.policy';

const STORE_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const API_VERSION = /^\d{4}-\d{2}$/;
const LOCATION_ID = /^(gid:\/\/shopify\/Location\/)?\d+$/;

export type ShopifyConfigParseResult =
  | { readonly ok: true; readonly config: ShopifyResolvedConfig }
  | { readonly ok: false; readonly issues: ReadonlyArray<{ path: string; message: string }> };

export function parseShopifyConfig(raw: Record<string, unknown> | null | undefined): ShopifyConfigParseResult {
  const config = raw ?? {};
  const issues: Array<{ path: string; message: string }> = [];

  const domainRaw = config.storeDomain;
  const storeDomain =
    typeof domainRaw === 'string'
      ? domainRaw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '')
      : '';
  if (!STORE_DOMAIN.test(storeDomain)) {
    issues.push({
      path: 'storeDomain',
      message: 'must be the shop\'s permanent domain, e.g. "my-shop.myshopify.com"',
    });
  }

  const versionRaw = config.apiVersion;
  let apiVersion = SHOPIFY_DEFAULT_API_VERSION;
  if (versionRaw !== undefined && versionRaw !== null && versionRaw !== '') {
    if (typeof versionRaw !== 'string' || !API_VERSION.test(versionRaw.trim())) {
      issues.push({ path: 'apiVersion', message: 'must look like "2026-10"' });
    } else {
      apiVersion = versionRaw.trim();
    }
  }

  const locationRaw = config.locationId;
  let locationGid: string | null = null;
  if (locationRaw !== undefined && locationRaw !== null && locationRaw !== '') {
    const text = typeof locationRaw === 'number' ? String(locationRaw) : locationRaw;
    if (typeof text !== 'string' || !LOCATION_ID.test(text.trim())) {
      issues.push({
        path: 'locationId',
        message: 'must be a Shopify Location id or GID (gid://shopify/Location/123)',
      });
    } else {
      locationGid = toShopifyGid('Location', text.trim());
    }
  }

  return issues.length > 0
    ? { ok: false, issues }
    : {
        ok: true,
        config: { storeDomain, apiVersion, locationGid, refundsThroughShopify: config.refundsThroughShopify === true },
      };
}

/** The `{handle}` of `{handle}.myshopify.com`, as the admin URL uses it. */
export function shopifyStoreHandle(storeDomain: string): string {
  return storeDomain.replace(/\.myshopify\.com$/, '');
}
