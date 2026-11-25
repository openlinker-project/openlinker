/**
 * WooCommerce Setup Form Schema
 *
 * Zod schema and form → API payload mapping for the guided WooCommerce
 * connection wizard. Maps user-visible fields (site URL, consumer key,
 * consumer secret) to the generic CreateConnectionInput shape. Credentials
 * are submitted as the `credentials` payload; the API persists them in the
 * integration credentials store and assigns a `db:<uuid>` reference.
 *
 * @module features/connections/components
 */
import { z } from 'zod';
import {
  DEFAULT_BUYER_DATA_WIZARD_VALUE,
  wizardBuyerDataConfig,
  type BuyerDataWizardValue,
} from '../../buyer-data';
import {
  CORE_CAPABILITY_VALUES,
  type CoreCapability,
  type CreateConnectionInput,
} from '../api/connections.types';
import { hasCapabilityConflict } from '../lib/capability-metadata';
import { schemaMessage } from '../lib/schema-message';
import {
  ORDER_SYNC_START_DEFAULT_VALUE,
  orderSyncStartSchema,
  readsOrders,
  toOrderSyncStart,
} from '../lib/order-sync-start';

const msg = schemaMessage('woocommerceSetupSchema');

export const WOOCOMMERCE_ADAPTER_KEY = 'woocommerce.restapi.v3';

/**
 * Fallback used when the adapter registry cannot be queried or has no
 * WooCommerce entry yet. Mirrors the chain manifest's capability set so a
 * connection created in that window can still run the master product /
 * inventory sync. The source of truth is the `/adapters` endpoint consumed
 * by the wizard via `useAdaptersQuery`.
 */
export const WOOCOMMERCE_FALLBACK_CAPABILITIES: CoreCapability[] = [
  'ProductMaster',
  'InventoryMaster',
  'OrderProcessorManager',
  'OrderSource',
];

// Mirrors the backend config DTO (`@IsUrl({ protocols: ['https'] })`):
// https-only, including local development (`https://localhost` is accepted,
// plain-http loopback is not — Basic Auth credentials must not travel in cleartext).
const isHttps = (value: string): boolean => value.startsWith('https://');

export const woocommerceSetupSchema = z.object({
  name: z.string().trim().min(1, msg('nameRequired')),
  siteUrl: z
    .string()
    .trim()
    .min(1, msg('siteUrlRequired'))
    .url(msg('siteUrlInvalid'))
    .refine(isHttps, msg('siteUrlHttps')),
  consumerKey: z
    .string()
    .trim()
    .min(1, msg('consumerKeyRequired'))
    .refine((v) => v.startsWith('ck_'), msg('consumerKeyPrefix')),
  consumerSecret: z
    .string()
    .trim()
    .min(1, msg('consumerSecretRequired'))
    .refine((v) => v.startsWith('cs_'), msg('consumerSecretPrefix')),
  enabledCapabilities: z
    .array(z.enum(CORE_CAPABILITY_VALUES))
    .default(WOOCOMMERCE_FALLBACK_CAPABILITIES)
    // Backstop for the UI disable-guard: the backend rejects this pair with a
    // 400, so the payload must never carry both.
    .refine(
      (capabilities) => !hasCapabilityConflict(capabilities),
      msg('capabilityConflict'),
    ),
  orderSyncStart: orderSyncStartSchema.default(ORDER_SYNC_START_DEFAULT_VALUE),
  // The answer to the "Buyer data" question (#4289); set through `setValue`.
  buyerDataRetention: z.custom<BuyerDataWizardValue>().optional(),
});

export type WoocommerceSetupFormValues = z.input<typeof woocommerceSetupSchema>;
export type WoocommerceSetupFormSubmission = z.output<typeof woocommerceSetupSchema>;

export const WOOCOMMERCE_SETUP_DEFAULT_VALUES: WoocommerceSetupFormValues = {
  name: '',
  siteUrl: '',
  consumerKey: '',
  consumerSecret: '',
  enabledCapabilities: WOOCOMMERCE_FALLBACK_CAPABILITIES,
  buyerDataRetention: DEFAULT_BUYER_DATA_WIZARD_VALUE,
  orderSyncStart: ORDER_SYNC_START_DEFAULT_VALUE,
};

export function toCreateConnectionInput(
  values: WoocommerceSetupFormSubmission
): CreateConnectionInput {
  return {
    name: values.name,
    platformType: 'woocommerce',
    adapterKey: WOOCOMMERCE_ADAPTER_KEY,
    credentials: { consumerKey: values.consumerKey, consumerSecret: values.consumerSecret },
    config: { siteUrl: values.siteUrl, ...wizardBuyerDataConfig(values.buyerDataRetention) },
    enabledCapabilities: values.enabledCapabilities,
    orderSyncStart: readsOrders(values.enabledCapabilities)
      ? toOrderSyncStart(values.orderSyncStart)
      : undefined,
  };
}
