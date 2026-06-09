/**
 * DPD Polska Setup Form Schema
 *
 * Zod schema + form → API payload mapping for the guided DPD Polska connection
 * wizard. DPD is a courier (shipping-only) — it carries Basic-auth credentials
 * (`login` / `password`), a payer account, and the sender address printed on
 * every label. There is no order-trigger model (DPD ships outbound; it never
 * sources orders), so the form has none.
 *
 * Client-side validation mirrors the BE config validator
 * (`libs/integrations/dpd-polska/.../dpd-connection-config.dto.ts`) for fast
 * feedback; the server stays the authoritative gate. `enabledCapabilities` is
 * intentionally omitted from the payload so the API defaults it to the
 * adapter's full `supportedCapabilities` (`['ShippingProviderManager']`).
 *
 * @module features/connections/components
 */
import { z } from 'zod';
import type { CreateConnectionInput } from '../api/connections.types';

export const DPD_ADAPTER_KEY = 'dpd.polska.rest.v1';

const PL_POSTAL = /^\d{2}-\d{3}$/;
const NUMERIC = /^\d+$/;

export const dpdSetupSchema = z.object({
  name: z.string().trim().min(1, 'Connection name is required'),
  // Credentials (Basic auth) — both required.
  login: z.string().trim().min(1, 'Login is required'),
  password: z.string().min(1, 'Password is required'),
  // Account config.
  environment: z.enum(['sandbox', 'production']),
  payerFid: z
    .string()
    .trim()
    .regex(NUMERIC, 'Payer FID must be a numeric id'),
  masterFid: z
    .union([z.string().trim().regex(NUMERIC, 'Master FID must be a numeric id'), z.literal('')])
    .optional(),
  // Sender address (printed on every label).
  senderCompany: z.string().trim().max(100).optional(),
  senderName: z.string().trim().max(100).optional(),
  senderAddress: z.string().trim().min(1, 'Sender address is required').max(100),
  senderCity: z.string().trim().min(1, 'Sender city is required').max(50),
  senderPostalCode: z.string().trim().regex(PL_POSTAL, 'Postal code must use the PL format NN-NNN'),
  senderCountryCode: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .pipe(z.string().regex(/^[A-Z]{2}$/, 'Country must be an ISO 3166-1 alpha-2 code (e.g. PL)')),
  senderPhone: z.string().trim().max(100).optional(),
  senderEmail: z
    .union([z.string().trim().email('Enter a valid email'), z.literal('')])
    .optional(),
});

export type DpdSetupFormValues = z.input<typeof dpdSetupSchema>;
export type DpdSetupFormSubmission = z.output<typeof dpdSetupSchema>;

export const DPD_SETUP_DEFAULT_VALUES: DpdSetupFormValues = {
  name: '',
  login: '',
  password: '',
  environment: 'sandbox',
  payerFid: '',
  masterFid: '',
  senderCompany: '',
  senderName: '',
  senderAddress: '',
  senderCity: '',
  senderPostalCode: '',
  senderCountryCode: 'PL',
  senderPhone: '',
  senderEmail: '',
};

export function toCreateConnectionInput(values: DpdSetupFormSubmission): CreateConnectionInput {
  const senderAddress: Record<string, unknown> = {
    address: values.senderAddress,
    city: values.senderCity,
    postalCode: values.senderPostalCode,
    countryCode: values.senderCountryCode,
  };
  if (values.senderCompany) senderAddress.company = values.senderCompany;
  if (values.senderName) senderAddress.name = values.senderName;
  if (values.senderPhone) senderAddress.phone = values.senderPhone;
  if (values.senderEmail && values.senderEmail.length > 0) senderAddress.email = values.senderEmail;

  const config: Record<string, unknown> = {
    environment: values.environment,
    payerFid: values.payerFid,
    senderAddress,
  };
  if (values.masterFid && values.masterFid.length > 0) {
    config.masterFid = values.masterFid;
  }

  return {
    name: values.name,
    platformType: 'dpd',
    adapterKey: DPD_ADAPTER_KEY,
    credentials: { login: values.login, password: values.password },
    config,
    // enabledCapabilities is OMITTED on purpose — and the omission is mandatory,
    // not just convenient: `'ShippingProviderManager'` is NOT in the BE's
    // `CoreCapabilityValues`, so passing it explicitly would fail the create DTO's
    // `@IsIn(CoreCapabilityValues)` with a 400. On the omitted path the service
    // defaults to the adapter manifest's supported set
    // (`ConnectionService.create`: `rest.enabledCapabilities ?? [...metadata.supportedCapabilities]`),
    // so the DPD connection lands with `['ShippingProviderManager']` enabled.
  };
}
