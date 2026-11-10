/**
 * Shopify Connection-Config Contribution (#3982)
 *
 * The non-render half of the Shopify edit section: the four top-level config
 * keys an operator sets once a store is connected - `locationId`,
 * `unmanagedStockQuantity`, `salesCountryIso2` and `refundsThroughShopify`.
 * The callback URL is the host-level `openlinkerCallbackBaseUrl` field.
 *
 * Each rule is no stricter than `parseShopifyConfig` on the API, which refuses
 * the same values on save.
 *
 * CLEARING WRITES `null`, NOT A DELETED KEY: the host submit merges
 * `{ ...fresh.config, ...input.config }` shallowly, so a deleted top-level key
 * would come back from the refetch. The API reads `null` like absent.
 * The refunds switch writes an explicit `false`: turning off a setting that
 * moves buyers' money must be visible in the saved config.
 *
 * @module plugins/shopify
 */
import { z } from 'zod';
import type { ConnectionConfigContribution } from '../../shared/plugins';
import { readOptionalConfigString } from '../../shared/plugins';
import { getShopifyMessages } from './messages';

declare module '../../shared/plugins/plugin.types' {
  interface PluginEditConnectionFields {
    /** `config.locationId` as a numeric id, `''` for the primary location. */
    shopifyLocationId?: string;
    /** `config.unmanagedStockQuantity`, entered as a string. */
    shopifyUnmanagedStockQuantity?: string;
    /** `config.salesCountryIso2`. */
    shopifySalesCountryIso2?: string;
    /** `config.refundsThroughShopify`, `'true'` or `''`. */
    shopifyRefundsThroughShopify?: string;
  }
}

const NUMERIC_ID = /^\d+$/;
const LOCATION_GID = /^gid:\/\/shopify\/Location\/(\d+)$/;
const WHOLE_NUMBER = /^\d+$/;
const ISO2 = /^[A-Za-z]{2}$/;

function optionalString(
  test: (value: string) => boolean,
  message: () => string,
): z.ZodTypeAny {
  return z
    .string()
    // The message is looked up when a value is validated, so it follows the
    // active language instead of freezing at module load.
    .refine((value) => value.trim() === '' || test(value.trim()), { error: message })
    .optional();
}

// Annotated so TS keeps the excess-property check live (the KSeF precedent).
const shopifySchemaShape: ConnectionConfigContribution['schemaShape'] = {
  shopifyLocationId: optionalString(
    (value) => NUMERIC_ID.test(value) || LOCATION_GID.test(value),
    () => getShopifyMessages().connectionConfig.locationIdInvalid,
  ),
  shopifyUnmanagedStockQuantity: optionalString(
    (value) => WHOLE_NUMBER.test(value),
    () => getShopifyMessages().connectionConfig.unmanagedStockInvalid,
  ),
  shopifySalesCountryIso2: optionalString(
    (value) => ISO2.test(value),
    () => getShopifyMessages().connectionConfig.salesCountryInvalid,
  ),
  shopifyRefundsThroughShopify: z.union([z.literal('true'), z.literal('')]).optional(),
};

/** A stored location id (numeric, GID or number) as the numeric id the picker uses. */
export function readLocationId(value: unknown): string {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return String(value);
  if (typeof value !== 'string') return '';
  const text = value.trim();
  return LOCATION_GID.exec(text)?.[1] ?? text;
}

function readShopifyConfig(config: Record<string, unknown>): Record<string, string> {
  const unmanaged = config.unmanagedStockQuantity;
  const country = config.salesCountryIso2;
  return {
    shopifyLocationId: readLocationId(config.locationId),
    shopifyUnmanagedStockQuantity:
      typeof unmanaged === 'number' && Number.isInteger(unmanaged) && unmanaged >= 0
        ? String(unmanaged)
        : '',
    shopifySalesCountryIso2: typeof country === 'string' ? country : '',
    shopifyRefundsThroughShopify: config.refundsThroughShopify === true ? 'true' : '',
  };
}

function applyShopifyConfig(
  config: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...config };

  const location = readOptionalConfigString(patch, 'shopifyLocationId');
  if (location !== undefined) {
    const id = readLocationId(location);
    next.locationId = NUMERIC_ID.test(id) ? id : null;
  }

  const unmanaged = readOptionalConfigString(patch, 'shopifyUnmanagedStockQuantity');
  if (unmanaged !== undefined) {
    const text = unmanaged.trim();
    next.unmanagedStockQuantity = WHOLE_NUMBER.test(text) ? Number.parseInt(text, 10) : null;
  }

  const country = readOptionalConfigString(patch, 'shopifySalesCountryIso2');
  if (country !== undefined) {
    const text = country.trim();
    next.salesCountryIso2 = ISO2.test(text) ? text.toUpperCase() : null;
  }

  const refunds = readOptionalConfigString(patch, 'shopifyRefundsThroughShopify');
  if (refunds !== undefined) {
    next.refundsThroughShopify = refunds === 'true';
  }

  return next;
}

export const shopifyConnectionConfig: ConnectionConfigContribution = {
  schemaShape: shopifySchemaShape,
  readConfigToForm: readShopifyConfig,
  applyToConfig: applyShopifyConfig,
};
