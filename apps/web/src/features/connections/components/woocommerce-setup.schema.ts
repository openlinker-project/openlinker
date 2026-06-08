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
import type { CoreCapability, CreateConnectionInput } from '../api/connections.types';

export const WOOCOMMERCE_ADAPTER_KEY = 'woocommerce.rest.v3';

/**
 * Fallback used only when the adapter registry cannot be queried.
 * The source of truth is the `/adapters` endpoint consumed by the wizard
 * via `useAdaptersQuery`.
 */
export const WOOCOMMERCE_FALLBACK_CAPABILITIES: CoreCapability[] = ['OrderSource'];

const isHttpsOrLoopback = (value: string): boolean =>
  value.startsWith('https://') ||
  value.startsWith('http://localhost') ||
  value.startsWith('http://127.');

export const woocommerceSetupSchema = z.object({
  name: z.string().trim().min(1, 'Connection name is required'),
  baseUrl: z
    .string()
    .trim()
    .min(1, 'Site URL is required')
    .url('Site URL must be a valid URL (e.g. https://shop.example.com)')
    .refine(isHttpsOrLoopback, 'Site URL must use HTTPS (or localhost for local development)'),
  consumerKey: z
    .string()
    .trim()
    .min(1, 'Consumer key is required')
    .refine((v) => v.startsWith('ck_'), 'Consumer key must start with ck_'),
  consumerSecret: z
    .string()
    .trim()
    .min(1, 'Consumer secret is required')
    .refine((v) => v.startsWith('cs_'), 'Consumer secret must start with cs_'),
  enabledCapabilities: z
    .array(
      z.enum([
        'ProductMaster',
        'InventoryMaster',
        'OrderProcessorManager',
        'OrderSource',
        'OfferManager',
      ]),
    )
    .default(WOOCOMMERCE_FALLBACK_CAPABILITIES),
});

export type WoocommerceSetupFormValues = z.input<typeof woocommerceSetupSchema>;
export type WoocommerceSetupFormSubmission = z.output<typeof woocommerceSetupSchema>;

export const WOOCOMMERCE_SETUP_DEFAULT_VALUES: WoocommerceSetupFormValues = {
  name: '',
  baseUrl: '',
  consumerKey: '',
  consumerSecret: '',
  enabledCapabilities: WOOCOMMERCE_FALLBACK_CAPABILITIES,
};

export function toCreateConnectionInput(
  values: WoocommerceSetupFormSubmission,
): CreateConnectionInput {
  return {
    name: values.name,
    platformType: 'woocommerce',
    adapterKey: WOOCOMMERCE_ADAPTER_KEY,
    credentials: { consumerKey: values.consumerKey, consumerSecret: values.consumerSecret },
    config: { baseUrl: values.baseUrl },
    enabledCapabilities: values.enabledCapabilities,
  };
}
