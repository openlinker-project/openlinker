/**
 * PrestaShop Payment Modules Curated List (#483)
 *
 * PrestaShop's `/api/modules` resource is **not** exposed to typical Webservice
 * API keys — granting it requires per-resource permissions most operators
 * never enable, and PrestaShop responds with `400 Bad Request` plus an
 * alphabetised list of resources the key actually has access to (which never
 * includes `modules`). Replaces a live `listResources<PrestashopModule>('modules')`
 * call that broke the operator-facing mapping page on every connection.
 *
 * Resolution chain (see `PrestashopOrderProcessorManagerAdapter.listPaymentMethods`):
 *   1. This curated list — covers native PS modules + the common Polish-market
 *      and international gateways our operators install.
 *   2. `PrestashopConnectionConfig.paymentModuleOverrides` — per-connection
 *      string list for shops running a non-curated module.
 *
 * The dropdown is purely a *write-side* concern: existing saved payment
 * mappings resolve at order-create time by exact `payment` string match, so
 * a missing entry here only blocks adding a new mapping for that gateway, it
 * does not break already-mapped orders.
 *
 * **Captured 2026-05-02.** Update this comment + the values below when adding
 * a new module — the file is the single source of truth.
 *
 * @module libs/integrations/prestashop/src/domain/types
 */

import type { MappingOption } from '@openlinker/core/orders';

export const PRESTASHOP_PAYMENT_MODULES: ReadonlyArray<MappingOption> = [
  // Native PrestaShop modules
  { value: 'ps_wirepayment', label: 'Bank wire transfer (ps_wirepayment)' },
  { value: 'ps_checkpayment', label: 'Cheque (ps_checkpayment)' },
  { value: 'ps_cashondelivery', label: 'Cash on delivery (ps_cashondelivery)' },
  // Polish-market gateways (priority — primary OL audience)
  { value: 'przelewy24', label: 'Przelewy24' },
  { value: 'tpay', label: 'Tpay' },
  { value: 'payu', label: 'PayU' },
  { value: 'bluepayment', label: 'Blue Media (BluePayment)' },
  { value: 'paynow', label: 'Paynow (mBank)' },
  { value: 'imoje', label: 'imoje (ING)' },
  // International gateways
  { value: 'paypal', label: 'PayPal' },
  { value: 'stripe', label: 'Stripe' },
  { value: 'klarna', label: 'Klarna' },
  { value: 'adyen', label: 'Adyen' },
];
