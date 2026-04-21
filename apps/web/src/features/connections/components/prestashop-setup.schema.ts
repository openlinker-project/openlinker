/**
 * PrestaShop Setup Form Schema
 *
 * Zod schema and form → API payload mapping for the guided PrestaShop
 * connection wizard. Maps user-visible fields (shop URL, webservice key,
 * optional shop ID) to the generic CreateConnectionInput shape. The
 * webservice key is submitted as the `credentials` payload; the API
 * persists it in the integration credentials store and assigns a
 * `db:<uuid>` reference automatically.
 */
import { z } from 'zod';
import type { Capability, CreateConnectionInput } from '../api/connections.types';

export const PRESTASHOP_ADAPTER_KEY = 'prestashop.webservice.v1';

/**
 * Fallback set used only when the adapter registry cannot be queried (network
 * failure, stale cache, etc.). The source of truth is the `/adapters` endpoint
 * consumed by the wizard via `useAdaptersQuery`.
 */
export const PRESTASHOP_FALLBACK_CAPABILITIES: Capability[] = [
  'ProductMaster',
  'InventoryMaster',
  'OrderProcessorManager',
  'OrderSource',
];

export const prestashopSetupSchema = z.object({
  name: z.string().trim().min(1, 'Connection name is required'),
  baseUrl: z
    .url('Shop URL must be a valid URL (e.g. https://shop.example.com)')
    .refine(
      (value) => value.startsWith('http://') || value.startsWith('https://'),
      'Shop URL must use http:// or https://',
    ),
  webserviceKey: z.string().trim().min(1, 'Webservice key is required'),
  shopId: z.string().trim().optional(),
  // Optional override for the split-host case (webservice host ≠ public storefront).
  // Empty string is accepted alongside absent so the form can round-trip a blank input
  // without surfacing a validation error; the create payload filters `""` out so the
  // backend falls back to `baseUrl` per #271.
  storefrontBaseUrl: z
    .union([
      z
        .url('Storefront URL must be a valid URL')
        .refine(
          (value) => value.startsWith('http://') || value.startsWith('https://'),
          'Storefront URL must use http:// or https://',
        ),
      z.literal(''),
    ])
    .optional(),
  enabledCapabilities: z
    .array(
      z.enum([
        'ProductMaster',
        'InventoryMaster',
        'OrderProcessorManager',
        'OrderSource',
        'Marketplace',
      ]),
    )
    .default(PRESTASHOP_FALLBACK_CAPABILITIES),
});

export type PrestashopSetupFormValues = z.input<typeof prestashopSetupSchema>;
export type PrestashopSetupFormSubmission = z.output<typeof prestashopSetupSchema>;

export const PRESTASHOP_SETUP_DEFAULT_VALUES: PrestashopSetupFormValues = {
  name: '',
  baseUrl: '',
  webserviceKey: '',
  shopId: '',
  storefrontBaseUrl: '',
  enabledCapabilities: PRESTASHOP_FALLBACK_CAPABILITIES,
};

export function toCreateConnectionInput(
  values: PrestashopSetupFormSubmission,
): CreateConnectionInput {
  const config: Record<string, unknown> = { baseUrl: values.baseUrl };
  if (values.shopId && values.shopId.length > 0) {
    config.shopId = values.shopId;
  }
  if (values.storefrontBaseUrl && values.storefrontBaseUrl.length > 0) {
    config.storefrontBaseUrl = values.storefrontBaseUrl;
  }
  return {
    name: values.name,
    platformType: 'prestashop',
    adapterKey: PRESTASHOP_ADAPTER_KEY,
    credentials: { webserviceApiKey: values.webserviceKey },
    config,
    enabledCapabilities: values.enabledCapabilities,
  };
}
