/**
 * eparagony.pl Setup Form Schema (#1911, document choice #3769)
 *
 * Zod schema + form -> API payload mapping for the guided eparagony.pl
 * connection wizard. Field set matches what the shipped adapter validators
 * require (#1908):
 *   - credentials: `clientId` + `clientSecret` mandatory, `integrationId`
 *     optional but must carry the vendor's `<integration>:<secret>` shape when
 *     supplied (EparagonyConnectionCredentialsShapeValidatorAdapter)
 *   - config: `environment` + `posId` mandatory
 *     (EparagonyConnectionConfigShapeValidatorAdapter)
 *
 * WHICH DOCUMENTS THE CONNECTION ISSUES IS THE OPERATOR'S CHOICE (#3769).
 * Until #3769 this file hardcoded `enabledCapabilities: ['Fiscalization']`, so
 * every wizard-made connection was receipts-only and invoicing was switched on
 * later with none of the seller details an invoice needs. The adapter then
 * refused every invoice before sending it - "the connection declares no seller
 * tax number" - and the operator saw only a generic provider-rejection toast.
 * The choice is now explicit, at least one is required, and each choice brings
 * the fields that make it work:
 *   - Invoicing needs `merchantTIN` (`composeInvoiceDocument` refuses without
 *     it). `merchantName` and `merchantAddress` are optional on an invoice and
 *     required only for a correction, so they are optional here too - never
 *     stricter than the gate (#2240). The address is one config object the
 *     validator accepts only whole, so a started address must be finished.
 *   - `eInvoicingHubEnabled` defaults to off, the adapter's own conservative
 *     reading: relaying to KSeF needs permissions OpenLinker cannot observe.
 *
 * The rest of the config (`taxRates`, `defaultTaxRateCode`, `print`,
 * `paymentForm`, ...) stays on the connection's edit form.
 *
 * Approved mockup: `docs/plans/mockups/eparagony-document-choice.html`.
 *
 * @module features/connections/components
 */
import { z } from 'zod';
import type { CreateConnectionInput } from '../../../features/connections';

export const EPARAGONY_ADAPTER_KEY = 'eparagony.documents.v3';

export const EparagonyEnvironmentValues = ['sandbox', 'production'] as const;

/** The two document lanes one eparagony.pl connection can carry, in product order. */
export const EparagonyDocumentCapabilityValues = ['Fiscalization', 'Invoicing'] as const;

export type EparagonyDocumentCapability = (typeof EparagonyDocumentCapabilityValues)[number];

/** Seller address fields a started address must fill. `merchantApartment` is the one optional part. */
export const EPARAGONY_SELLER_ADDRESS_REQUIRED_FIELDS = [
  'merchantStreet',
  'merchantNumber',
  'merchantPostalCode',
  'merchantCity',
  'merchantCountry',
] as const;

/**
 * Fields whose content means "the operator started an address". Country is
 * left out on purpose: it is prefilled with `PL`, and that default alone must
 * not make an untouched address count as half-filled.
 */
const SELLER_ADDRESS_STARTED_FIELDS = [
  'merchantStreet',
  'merchantNumber',
  'merchantApartment',
  'merchantPostalCode',
  'merchantCity',
] as const;

export const EPARAGONY_DOCUMENT_CHOICE_REQUIRED_MESSAGE =
  'Pick at least one: e-receipts, invoices, or both.';
export const EPARAGONY_MERCHANT_TIN_REQUIRED_MESSAGE =
  'Tax number (NIP) is required to issue invoices';
export const EPARAGONY_ADDRESS_PART_REQUIRED_MESSAGE = 'Required.';

const text = z.string().trim();

export const eparagonySetupSchema = z
  .object({
    enabledCapabilities: z.array(z.enum(EparagonyDocumentCapabilityValues)),
    name: text.min(1, 'Connection name is required'),
    clientId: text.min(1, 'Client ID is required'),
    clientSecret: text.min(1, 'Client secret is required'),
    integrationId: text
      .refine((value) => value.length === 0 || value.includes(':'), {
        message: 'Must be of the form integration:secret, e.g. openlinker:abc123',
      })
      .optional(),
    posId: text.min(1, 'POS ID is required'),
    environment: z.enum(EparagonyEnvironmentValues),
    merchantTIN: text,
    merchantName: text,
    merchantStreet: text,
    merchantNumber: text,
    merchantApartment: text,
    merchantPostalCode: text,
    merchantCity: text,
    // Mirrors the backend's `ISO_ALPHA2_PATTERN` - a shape check only.
    merchantCountry: text.refine((value) => value === '' || /^[A-Za-z]{2}$/.test(value), {
      message: 'Use the two-letter code, e.g. PL.',
    }),
    eInvoicingHubEnabled: z.boolean(),
  })
  .superRefine((values, ctx) => {
    if (values.enabledCapabilities.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['enabledCapabilities'],
        message: EPARAGONY_DOCUMENT_CHOICE_REQUIRED_MESSAGE,
      });
    }
    // Seller rules apply only to the lane that reads them: a receipts-only
    // connection never sends a seller, so a value left in a hidden field must
    // not block it.
    if (!values.enabledCapabilities.includes('Invoicing')) return;
    if (values.merchantTIN === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['merchantTIN'],
        message: EPARAGONY_MERCHANT_TIN_REQUIRED_MESSAGE,
      });
    }
    if (isSellerAddressStarted(values)) {
      for (const field of EPARAGONY_SELLER_ADDRESS_REQUIRED_FIELDS) {
        if (values[field] === '') {
          ctx.addIssue({
            code: 'custom',
            path: [field],
            message: EPARAGONY_ADDRESS_PART_REQUIRED_MESSAGE,
          });
        }
      }
    }
  });

export type EparagonySetupFormValues = z.input<typeof eparagonySetupSchema>;
export type EparagonySetupFormSubmission = z.output<typeof eparagonySetupSchema>;

export const EPARAGONY_SETUP_DEFAULT_VALUES: EparagonySetupFormValues = {
  enabledCapabilities: ['Fiscalization'],
  name: '',
  clientId: '',
  clientSecret: '',
  integrationId: '',
  posId: '',
  environment: 'sandbox',
  merchantTIN: '',
  merchantName: '',
  merchantStreet: '',
  merchantNumber: '',
  merchantApartment: '',
  merchantPostalCode: '',
  merchantCity: '',
  merchantCountry: 'PL',
  eInvoicingHubEnabled: false,
};

function isSellerAddressStarted(
  values: Pick<EparagonySetupFormSubmission, (typeof SELLER_ADDRESS_STARTED_FIELDS)[number]>,
): boolean {
  return SELLER_ADDRESS_STARTED_FIELDS.some((field) => values[field].trim() !== '');
}

/** The selection in product order (receipts, invoices), whatever order it was ticked in. */
export function orderDocumentCapabilities(
  selected: readonly string[],
): EparagonyDocumentCapability[] {
  return EparagonyDocumentCapabilityValues.filter((capability) => selected.includes(capability));
}

function toSellerConfig(values: EparagonySetupFormSubmission): Record<string, unknown> {
  const address = isSellerAddressStarted(values)
    ? {
        street: values.merchantStreet,
        number: values.merchantNumber,
        ...(values.merchantApartment ? { apartment: values.merchantApartment } : {}),
        postalCode: values.merchantPostalCode,
        city: values.merchantCity,
        country: values.merchantCountry.toUpperCase(),
      }
    : undefined;
  return {
    merchantTIN: values.merchantTIN,
    ...(values.merchantName ? { merchantName: values.merchantName } : {}),
    ...(address ? { merchantAddress: address } : {}),
    eInvoicingHubEnabled: values.eInvoicingHubEnabled,
  };
}

export function toCreateConnectionInput(
  values: EparagonySetupFormSubmission,
): CreateConnectionInput {
  const integrationId = values.integrationId?.trim();
  const enabledCapabilities = orderDocumentCapabilities(values.enabledCapabilities);
  return {
    name: values.name,
    platformType: 'eparagony',
    adapterKey: EPARAGONY_ADAPTER_KEY,
    credentials: {
      clientId: values.clientId,
      clientSecret: values.clientSecret,
      ...(integrationId && integrationId.length > 0 ? { integrationId } : {}),
    },
    config: {
      environment: values.environment,
      posId: values.posId,
      // Seller fields are written only for a connection that issues invoices;
      // a receipts-only connection keeps the config it always had.
      ...(enabledCapabilities.includes('Invoicing') ? toSellerConfig(values) : {}),
    },
    // Always sent explicitly: omitting it would let `ConnectionService.create`
    // default to the whole manifest and mint a connection claiming a lane the
    // operator did not choose (#3192).
    enabledCapabilities,
  };
}
