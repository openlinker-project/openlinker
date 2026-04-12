/**
 * PrestaShop Setup Form Schema
 *
 * Zod schema and form → API payload mapping for the guided PrestaShop
 * connection wizard. Maps user-visible fields (shop URL, webservice key,
 * optional shop ID) to the generic CreateConnectionInput shape
 * ({ platformType, adapterKey, config, credentialsRef }).
 *
 * NOTE: Until the API exposes an endpoint to register an integration
 * credential from a raw key, the webservice key is sent directly as
 * `credentialsRef`. This matches current MVP backend behavior but
 * overloads a field documented as an opaque reference. Follow-up work
 * will introduce a credentials-create step so the raw key never appears
 * in the connection payload.
 */
import { z } from 'zod';
import type { CreateConnectionInput } from '../api/connections.types';

export const PRESTASHOP_ADAPTER_KEY = 'prestashop.webservice.v1';

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
});

export type PrestashopSetupFormValues = z.input<typeof prestashopSetupSchema>;
export type PrestashopSetupFormSubmission = z.output<typeof prestashopSetupSchema>;

export const PRESTASHOP_SETUP_DEFAULT_VALUES: PrestashopSetupFormValues = {
  name: '',
  baseUrl: '',
  webserviceKey: '',
  shopId: '',
};

export function toCreateConnectionInput(
  values: PrestashopSetupFormSubmission,
): CreateConnectionInput {
  const config: Record<string, unknown> = { baseUrl: values.baseUrl };
  if (values.shopId && values.shopId.length > 0) {
    config.shopId = values.shopId;
  }
  return {
    name: values.name,
    platformType: 'prestashop',
    adapterKey: PRESTASHOP_ADAPTER_KEY,
    credentialsRef: values.webserviceKey,
    config,
  };
}
