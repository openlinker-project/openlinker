/**
 * Shoper Setup Form Schema
 *
 * Zod schema + form → API payload mapping for the guided Shoper connection
 * wizard (four steps: shop, token, capabilities, review). Shoper is authenticated with a single static Bearer token ("Token
 * API", issued by the shop's own admin panel). The form collects a connection
 * name, the shop host (`baseUrl`) and the token.
 *
 * Host rules (https only, no path / port / IP) are enforced by the BE shape
 * validator and surfaced through the create error Alert - the FE does not
 * mirror them, so the two cannot drift.
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
import { schemaMessage } from '../lib/schema-message';
import {
  ORDER_SYNC_START_DEFAULT_VALUE,
  addOrderSyncStartIssues,
  orderSyncStartShape,
  readsOrders,
  toOrderSyncStart,
} from '../lib/order-sync-start';

const msg = schemaMessage('shoperSetupSchema');

export const SHOPER_ADAPTER_KEY = 'shoper.restapi.v1';

/**
 * Capabilities the wizard offers when the adapter list is not available, and the
 * ones it pre-selects: the manifest's `defaultEnabledCapabilities`. Receiving
 * orders (`OrderProcessorManager`) and ingesting them (`OrderSource`) stay
 * opt-in because each puts load on the shop or starts creating orders in it.
 */
export const SHOPER_FALLBACK_CAPABILITIES: CoreCapability[] = [
  'ProductMaster',
  'InventoryMaster',
  'OrderProcessorManager',
  'OrderSource',
];

export const SHOPER_DEFAULT_CAPABILITIES: CoreCapability[] = ['ProductMaster', 'InventoryMaster'];

export const shoperSetupSchema = z
  .object({
    name: z.string().trim().min(1, msg('nameRequired')),
    baseUrl: z.string().trim().min(1, msg('baseUrlRequired')),
    token: z.string().trim().min(1, msg('tokenRequired')),
    enabledCapabilities: z.array(z.enum(CORE_CAPABILITY_VALUES)).default(SHOPER_DEFAULT_CAPABILITIES),
    orderSyncStart: orderSyncStartShape.default(ORDER_SYNC_START_DEFAULT_VALUE),
    // The answer to the "Buyer data" question (#4289); set through `setValue`.
    buyerDataRetention: z.custom<BuyerDataWizardValue>().optional(),
  })
  .superRefine((values, ctx) => {
    // The start date is only validated when the step that asks for it exists.
    // An answer to a hidden question (OrderSource unticked after a date was
    // typed) must not block the submit, and the payload drops it anyway.
    if (readsOrders(values.enabledCapabilities)) {
      addOrderSyncStartIssues(values.orderSyncStart, ctx);
    }
  });

export type ShoperSetupFormValues = z.input<typeof shoperSetupSchema>;
export type ShoperSetupFormSubmission = z.output<typeof shoperSetupSchema>;

export const SHOPER_SETUP_DEFAULT_VALUES: ShoperSetupFormValues = {
  name: '',
  baseUrl: '',
  token: '',
  enabledCapabilities: SHOPER_DEFAULT_CAPABILITIES,
  orderSyncStart: ORDER_SYNC_START_DEFAULT_VALUE,
  buyerDataRetention: DEFAULT_BUYER_DATA_WIZARD_VALUE,
};

export function toCreateConnectionInput(values: ShoperSetupFormSubmission): CreateConnectionInput {
  return {
    name: values.name,
    platformType: 'shoper',
    adapterKey: SHOPER_ADAPTER_KEY,
    credentials: { token: values.token },
    config: { baseUrl: values.baseUrl, ...wizardBuyerDataConfig(values.buyerDataRetention) },
    enabledCapabilities: values.enabledCapabilities,
    orderSyncStart: readsOrders(values.enabledCapabilities)
      ? toOrderSyncStart(values.orderSyncStart)
      : undefined,
  };
}
