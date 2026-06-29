/**
 * InPost Setup Form Schema (#771)
 *
 * Zod schema + form → API payload mapping for the guided InPost (ShipX)
 * connection wizard. InPost is a carrier (shipping-only) — it carries a single
 * ShipX Bearer `apiToken` credential, an environment, an organization id, and
 * the sender contact populated on every shipment.
 *
 * Client-side validation mirrors the BE config validator
 * (`libs/integrations/inpost/.../inpost-connection-config.dto.ts`) for fast
 * feedback; the server stays the authoritative gate. `enabledCapabilities` is
 * intentionally omitted from the payload so the API defaults it to the
 * adapter's full `supportedCapabilities` (`['ShippingProviderManager']`) —
 * `ShippingProviderManager` is NOT in the FE's `CoreCapabilityValues`, so
 * sending it would fail the create DTO's `@IsIn` with a 400.
 *
 * @module features/connections/components
 */
import { z } from 'zod';
import type { CreateConnectionInput } from '../api/connections.types';

export const INPOST_ADAPTER_KEY = 'inpost.shipx.v1';

const PL_POSTAL = /^\d{2}-\d{3}$/;

export const inpostSetupSchema = z.object({
  name: z.string().trim().min(1, 'Connection name is required'),
  // Credential (ShipX Bearer token) — required, write-only.
  apiToken: z.string().trim().min(1, 'API token is required'),
  // Account config.
  environment: z.enum(['sandbox', 'production']),
  organizationId: z.string().trim().min(1, 'Organization ID is required'),
  // Sender contact (populated on every shipment).
  senderName: z.string().trim().max(200).optional(),
  senderEmail: z.string().trim().email('Enter a valid email'),
  senderPhone: z.string().trim().min(1, 'Sender phone is required').max(30),
  senderStreet: z.string().trim().min(1, 'Street is required').max(200),
  senderBuildingNumber: z.string().trim().min(1, 'Building number is required').max(50),
  senderCity: z.string().trim().min(1, 'City is required').max(200),
  senderPostCode: z.string().trim().regex(PL_POSTAL, 'Postcode must use the PL format NN-NNN'),
  senderCountryCode: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .pipe(z.string().regex(/^[A-Z]{2}$/, 'Country must be an ISO 3166-1 alpha-2 code (e.g. PL)')),
});

export type InpostSetupFormValues = z.input<typeof inpostSetupSchema>;
export type InpostSetupFormSubmission = z.output<typeof inpostSetupSchema>;

export const INPOST_SETUP_DEFAULT_VALUES: InpostSetupFormValues = {
  name: '',
  apiToken: '',
  environment: 'sandbox',
  organizationId: '',
  senderName: '',
  senderEmail: '',
  senderPhone: '',
  senderStreet: '',
  senderBuildingNumber: '',
  senderCity: '',
  senderPostCode: '',
  senderCountryCode: 'PL',
};

export function toCreateConnectionInput(values: InpostSetupFormSubmission): CreateConnectionInput {
  const senderAddress: Record<string, unknown> = {
    email: values.senderEmail,
    phone: values.senderPhone,
    address: {
      street: values.senderStreet,
      buildingNumber: values.senderBuildingNumber,
      city: values.senderCity,
      postCode: values.senderPostCode,
      countryCode: values.senderCountryCode,
    },
  };
  if (values.senderName && values.senderName.length > 0) senderAddress.name = values.senderName;

  return {
    name: values.name,
    platformType: 'inpost',
    adapterKey: INPOST_ADAPTER_KEY,
    config: {
      environment: values.environment,
      organizationId: values.organizationId,
      senderAddress,
    },
    // Write-only: `apiToken` never round-trips back to the browser.
    credentials: { apiToken: values.apiToken },
    // enabledCapabilities OMITTED on purpose — see file header.
  };
}
