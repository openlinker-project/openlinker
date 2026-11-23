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
import {
  ORDER_SYNC_START_DEFAULT_VALUE,
  orderSyncStartSchema,
  readsOrders,
  toOrderSyncStart,
  type CoreCapability,
  type CreateConnectionInput,
} from '../../connections';

export const SHOPIFY_ADAPTER_KEY = 'shopify.admin.v1';

export const ShopifySetupModeValues = ['client-credentials', 'access-token', 'oauth'] as const;
export type ShopifySetupMode = (typeof ShopifySetupModeValues)[number];

/**
 * What the connection is FOR. Each preset is a capability set that core accepts
 * as it stands: ProductMaster and ProductPublisher are never combined on one
 * connection (#3985, `CONNECTION_MASTER_PUBLISHER_CONFLICT`), because whatever
 * is published to a shop is read back by that shop's own catalogue sync.
 */
export const ShopifySetupRoleValues = ['master', 'publisher'] as const;
export type ShopifySetupRole = (typeof ShopifySetupRoleValues)[number];

export const SHOPIFY_ROLE_CAPABILITIES: Record<ShopifySetupRole, CoreCapability[]> = {
  master: ['ProductMaster', 'InventoryMaster', 'OrderSource', 'OrderProcessorManager'],
  publisher: ['ProductPublisher', 'CategoryProvisioner', 'OfferManager'],
};

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
    role: z.enum(ShopifySetupRoleValues),
    clientId: z.string().trim(),
    clientSecret: z.string().trim(),
    accessToken: z.string().trim(),
    locationId: z.string().trim(),
    orderSyncStart: orderSyncStartSchema.default(ORDER_SYNC_START_DEFAULT_VALUE),
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
  role: 'master',
  clientId: '',
  clientSecret: '',
  accessToken: '',
  locationId: '',
  orderSyncStart: ORDER_SYNC_START_DEFAULT_VALUE,
};

/** The config seed shared by a direct create and an OAuth install. */
export function toShopifyConfig(values: ShopifySetupFormSubmission): Record<string, unknown> {
  return {
    storeDomain: values.storeDomain,
    ...(values.locationId ? { locationId: values.locationId } : {}),
  };
}

/**
 * Whether the order-history choice applies: the role must read orders, and the
 * OAuth install carries no start (its connect call has no such field), so the
 * choice is only asked in the two direct-create modes.
 */
export function asksOrderSyncStart(role: ShopifySetupRole, mode: ShopifySetupMode): boolean {
  return mode !== 'oauth' && readsOrders(SHOPIFY_ROLE_CAPABILITIES[role]);
}

/** Create payload for the two modes that need no redirect. */
export function toCreateConnectionInput(values: ShopifySetupFormSubmission): CreateConnectionInput {
  return {
    name: values.name,
    platformType: 'shopify',
    adapterKey: SHOPIFY_ADAPTER_KEY,
    config: toShopifyConfig(values),
    enabledCapabilities: SHOPIFY_ROLE_CAPABILITIES[values.role],
    orderSyncStart: asksOrderSyncStart(values.role, values.mode)
      ? toOrderSyncStart(values.orderSyncStart)
      : undefined,
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
