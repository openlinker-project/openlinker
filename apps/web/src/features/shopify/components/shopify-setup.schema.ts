/**
 * Shopify Setup Form Schema
 *
 * The three ways to connect a store (#3974): app client id + secret (a store
 * in the app's own organization), a pre-issued access token, or an OAuth
 * install (a store in another organization). The store domain is checked for
 * shape only; the backend validator and the connection test have the final
 * word, so the two cannot drift.
 *
 * @module features/shopify/components
 */
import { z } from 'zod';
import type { CreateConnectionInput } from '../../connections';

export const SHOPIFY_ADAPTER_KEY = 'shopify.admin.v1';

export const ShopifySetupModeValues = ['client-credentials', 'access-token', 'oauth'] as const;
export type ShopifySetupMode = (typeof ShopifySetupModeValues)[number];

const STORE_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export function normaliseStoreDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

/**
 * Validation messages are message KEYS of the `shopify.setup` namespace, so
 * the schema is static and the form translates what it shows.
 */
export const ShopifySetupErrorKeyValues = ['required', 'storeDomainInvalid'] as const;
export type ShopifySetupErrorKey = (typeof ShopifySetupErrorKeyValues)[number];

export const shopifySetupSchema = z
  .object({
    name: z.string().trim().min(1, 'required'),
    storeDomain: z
      .string()
      .transform(normaliseStoreDomain)
      .refine((value) => STORE_DOMAIN.test(value), 'storeDomainInvalid'),
    mode: z.enum(ShopifySetupModeValues),
    clientId: z.string().trim(),
    clientSecret: z.string().trim(),
    accessToken: z.string().trim(),
    locationId: z.string().trim(),
  })
  .superRefine((values, ctx) => {
    const need = (field: 'clientId' | 'clientSecret' | 'accessToken'): void => {
      if (values[field].length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: 'required' });
      }
    };
    if (values.mode === 'access-token') {
      need('accessToken');
    } else {
      need('clientId');
      need('clientSecret');
    }
  });

export type ShopifySetupFormValues = z.input<typeof shopifySetupSchema>;
export type ShopifySetupFormSubmission = z.output<typeof shopifySetupSchema>;

export const SHOPIFY_SETUP_DEFAULT_VALUES: ShopifySetupFormValues = {
  name: '',
  storeDomain: '',
  mode: 'client-credentials',
  clientId: '',
  clientSecret: '',
  accessToken: '',
  locationId: '',
};

/** The config seed shared by a direct create and an OAuth install. */
export function toShopifyConfig(values: ShopifySetupFormSubmission): Record<string, unknown> {
  return {
    storeDomain: values.storeDomain,
    ...(values.locationId ? { locationId: values.locationId } : {}),
  };
}

/** Create payload for the two modes that need no redirect. */
export function toCreateConnectionInput(values: ShopifySetupFormSubmission): CreateConnectionInput {
  return {
    name: values.name,
    platformType: 'shopify',
    adapterKey: SHOPIFY_ADAPTER_KEY,
    config: toShopifyConfig(values),
    credentials:
      values.mode === 'access-token'
        ? { accessToken: values.accessToken }
        : { clientId: values.clientId, clientSecret: values.clientSecret },
  };
}

/** The page Shopify redirects back to; it must be registered on the app. */
export function shopifyOAuthRedirectUri(origin: string): string {
  return `${origin}/integrations/shopify/connect/callback`;
}
