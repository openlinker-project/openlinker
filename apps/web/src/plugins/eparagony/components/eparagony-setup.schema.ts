/**
 * eparagony.pl Setup Form Schema (#1911)
 *
 * Zod schema + form -> API payload mapping for the guided eparagony.pl
 * connection wizard. Field set matches EXACTLY what the shipped adapter
 * validators require (#1908):
 *   - credentials: `clientId` + `clientSecret` mandatory, `integrationId`
 *     optional but must carry the vendor's `<integration>:<secret>` shape when
 *     supplied (EparagonyConnectionCredentialsShapeValidatorAdapter)
 *   - config: `environment` + `posId` mandatory
 *     (EparagonyConnectionConfigShapeValidatorAdapter)
 *
 * Every other config field (`taxRates`, `defaultTaxRateCode`, `print`,
 * `paymentForm`, `paymentName`, `statusPollTimeoutMs`,
 * `fiscalDeviceUniqueNumber`) is either rare enough or regime-specific enough
 * to leave to the generic raw-JSON config editor, matching the Erli setup
 * form's precedent for the same split.
 *
 * @module features/connections/components
 */
import { z } from 'zod';
import type { CreateConnectionInput } from '../api/connections.types';

export const EPARAGONY_ADAPTER_KEY = 'eparagony.documents.v3';

export const EparagonyEnvironmentValues = ['sandbox', 'production'] as const;

export const eparagonySetupSchema = z.object({
  name: z.string().trim().min(1, 'Connection name is required'),
  clientId: z.string().trim().min(1, 'Client ID is required'),
  clientSecret: z.string().trim().min(1, 'Client secret is required'),
  integrationId: z
    .string()
    .trim()
    .refine((value) => value.length === 0 || value.includes(':'), {
      message: 'Must be of the form integration:secret, e.g. openlinker:abc123',
    })
    .optional(),
  posId: z.string().trim().min(1, 'POS ID is required'),
  environment: z.enum(EparagonyEnvironmentValues),
});

export type EparagonySetupFormValues = z.input<typeof eparagonySetupSchema>;
export type EparagonySetupFormSubmission = z.output<typeof eparagonySetupSchema>;

export const EPARAGONY_SETUP_DEFAULT_VALUES: EparagonySetupFormValues = {
  name: '',
  clientId: '',
  clientSecret: '',
  integrationId: '',
  posId: '',
  environment: 'sandbox',
};

export function toCreateConnectionInput(
  values: EparagonySetupFormSubmission,
): CreateConnectionInput {
  const integrationId = values.integrationId?.trim();
  return {
    name: values.name,
    platformType: 'eparagony',
    adapterKey: EPARAGONY_ADAPTER_KEY,
    credentials: {
      clientId: values.clientId,
      clientSecret: values.clientSecret,
      // Omitted rather than sent empty: the credentials validator treats an
      // absent integrationId as fine (unenforced on reads today) but would
      // reject an empty string against the `<integration>:<secret>` shape.
      ...(integrationId && integrationId.length > 0 ? { integrationId } : {}),
    },
    config: { environment: values.environment, posId: values.posId },
    // SENT EXPLICITLY, and the explicitness is the point (#3192 slice 2).
    //
    // Omitting it makes `ConnectionService.create` default to the adapter
    // manifest's supported set, which now carries `'Invoicing'` - so a wizard
    // that collects an environment, a POS id and credentials, and no seller
    // invoicing configuration at all, would mint a connection that claims it
    // can issue invoices. That is the same rule the plugin applies to
    // `CorrectionIssuer` one layer down: a capability is advertised together
    // with the ability to deliver it, never ahead of it. It is also visible
    // rather than cosmetic - `selectInvoicingCandidates` filters on this array,
    // so a second candidate appearing beside an existing inFakt/KSeF connection
    // turns that install's one-click issue into a must-ask pick; and
    // `deriveSalesDocumentRows` tests `'Invoicing'` BEFORE `'Fiscalization'`,
    // so a receipts connection would render as an Invoicing row in Settings ->
    // Sales documents.
    //
    // `'Fiscalization'` ALONE, not the manifest's four: the create DTO validates
    // this array with `@IsIn(CoreCapabilityValues, { each: true })`, and neither
    // `'FiscalRegistrationLocator'` nor `'RegulatoryStatusReader'` is a
    // `CoreCapability` - sending either would 400. Nothing reads those two names
    // off `enabledCapabilities` anywhere (both are narrowed from the dispatched
    // adapter with their `is*` guard), and `ConnectionCapabilitiesPanel` saves
    // the `isCoreCapability`-filtered set, so this is exactly where the
    // connection lands after the operator's first toggle either way.
    //
    // The operator turns the invoice lane on from the connection page, which is
    // where the seller fields are configured too.
    enabledCapabilities: ['Fiscalization'],
  };
}
