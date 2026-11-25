/**
 * Erli Setup Form Schema
 *
 * Zod schema + form → API payload mapping for the guided Erli connection
 * wizard. Erli is a marketplace authenticated with a single Shop API key
 * (sent as a Bearer token by the BE adapter, #981). The form collects a
 * connection name, the required `apiKey` credential, and an `environment`
 * select (Production/Sandbox, #1377). The payload persists the neutral
 * `config.environment` choice — the BE adapter factory resolves it to the
 * concrete Shop API base URL — so no sandbox-URL literal is duplicated on the
 * FE and a future URL change never leaves a stale literal in stored
 * connections. `enabledCapabilities` is intentionally omitted from the payload
 * so the API defaults it to the adapter manifest's supported set (#984/#993
 * ship `OfferManager` / `OrderSource`). The wizard's "Sales documents" step adds
 * `config.deliveryOnDocuments` (#3911, ADR-082). The credentials step also asks
 * whether the connection has a product catalogue (#4281); only an explicit
 * `none` is persisted as `config.catalogueMode`.
 *
 * @module features/connections/components
 */
import { z } from 'zod';
import {
  DEFAULT_BUYER_DATA_WIZARD_VALUE,
  wizardBuyerDataConfig,
  type BuyerDataWizardValue,
} from '../../buyer-data';
import type { CreateConnectionInput } from '../api/connections.types';
import {
  DEFAULT_DELIVERY_WIZARD_VALUE,
  wizardConfig,
  type DeliveryLineSuggestion,
  type DeliveryWizardValue,
} from '../../delivery-on-documents';
import { CatalogueModeValues } from '../lib/catalogue-mode';
import { schemaMessage } from '../lib/schema-message';
import {
  ORDER_SYNC_START_DEFAULT_VALUE,
  orderSyncStartSchema,
  toOrderSyncStart,
} from '../lib/order-sync-start';

const msg = schemaMessage('erliSetupSchema');

export const ERLI_ADAPTER_KEY = 'erli.shopapi.v1';

export const ErliEnvironmentValues = ['sandbox', 'production'] as const;

export const erliSetupSchema = z.object({
  name: z.string().trim().min(1, msg('nameRequired')),
  apiKey: z.string().trim().min(1, msg('apiKeyRequired')),
  environment: z.enum(ErliEnvironmentValues),
  // Whether this connection expects its order lines to resolve to catalogue
  // products (#4281); set through `setValue`.
  catalogueMode: z.enum(CatalogueModeValues).optional(),
  // The answer to the "Sales documents" step; set through `setValue` (#3911).
  deliveryOnDocuments: z.custom<DeliveryWizardValue>().optional(),
  // The answer to the "Buyer data" question (#4289); set through `setValue`.
  buyerDataRetention: z.custom<BuyerDataWizardValue>().optional(),
  orderSyncStart: orderSyncStartSchema.default(ORDER_SYNC_START_DEFAULT_VALUE),
});

export type ErliSetupFormValues = z.input<typeof erliSetupSchema>;
export type ErliSetupFormSubmission = z.output<typeof erliSetupSchema>;

export const ERLI_SETUP_DEFAULT_VALUES: ErliSetupFormValues = {
  name: '',
  apiKey: '',
  environment: 'sandbox',
  catalogueMode: 'linked',
  deliveryOnDocuments: DEFAULT_DELIVERY_WIZARD_VALUE,
  buyerDataRetention: DEFAULT_BUYER_DATA_WIZARD_VALUE,
  orderSyncStart: ORDER_SYNC_START_DEFAULT_VALUE,
};

export function toCreateConnectionInput(
  values: ErliSetupFormSubmission,
  suggestions: readonly DeliveryLineSuggestion[] = []
): CreateConnectionInput {
  return {
    name: values.name,
    platformType: 'erli',
    adapterKey: ERLI_ADAPTER_KEY,
    credentials: { apiKey: values.apiKey },
    // Persist the neutral choice, not a derived URL: the BE adapter factory
    // maps `environment` → the concrete Shop API base URL, so a future
    // sandbox-URL change can't leave a stale literal in this connection's config.
    config: {
      environment: values.environment,
      // linked is the default and an absent key already reads as linked.
      ...(values.catalogueMode === 'none' ? { catalogueMode: 'none' } : {}),
      deliveryOnDocuments: wizardConfig(
        values.deliveryOnDocuments ?? DEFAULT_DELIVERY_WIZARD_VALUE,
        suggestions
      ),
      ...wizardBuyerDataConfig(values.buyerDataRetention),
    },
    orderSyncStart: toOrderSyncStart(values.orderSyncStart),
    // enabledCapabilities is OMITTED on purpose: on the omitted path
    // `ConnectionService.create` defaults to the adapter manifest's supported
    // set (`rest.enabledCapabilities ?? [...metadata.supportedCapabilities]`),
    // so the Erli connection lands with the capabilities the registered
    // `erli.shopapi.v1` adapter actually delivers.
  };
}
