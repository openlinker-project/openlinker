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
import { schemaMessage } from '../lib/schema-message';

const msg = schemaMessage('inpostSetupSchema');

export const INPOST_ADAPTER_KEY = 'inpost.shipx.v1';

const PL_POSTAL = /^\d{2}-\d{3}$/;

export const inpostSetupSchema = z.object({
  name: z.string().trim().min(1, msg('nameRequired')),
  // Credential (ShipX Bearer token) — required, write-only.
  apiToken: z.string().trim().min(1, msg('apiTokenRequired')),
  // Account config.
  environment: z.enum(['sandbox', 'production']),
  organizationId: z.string().trim().min(1, msg('organizationIdRequired')),
  // Sender contact (populated on every shipment).
  senderName: z.string().trim().max(200).optional(),
  senderEmail: z.string().trim().email(msg('emailInvalid')),
  senderPhone: z.string().trim().min(1, msg('phoneRequired')).max(30),
  senderStreet: z.string().trim().min(1, msg('streetRequired')).max(200),
  senderBuildingNumber: z.string().trim().min(1, msg('buildingNumberRequired')).max(50),
  senderCity: z.string().trim().min(1, msg('cityRequired')).max(200),
  senderPostCode: z.string().trim().regex(PL_POSTAL, msg('postCodeFormat')),
  senderCountryCode: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .pipe(z.string().regex(/^[A-Z]{2}$/, msg('countryFormat'))),
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
