/**
 * Allegro payment-refund wire types
 *
 * Shape of `GET /payments/refunds` (verified live on the sandbox, #4126). Only
 * the fields OpenLinker reads are declared.
 *
 * @module libs/integrations/allegro/src/domain/types
 */
export interface AllegroPaymentRefundWire {
  id?: string;
  /** `SUCCESS` is the only settled value; other statuses moved no money. */
  status?: string;
  createdAt?: string;
  totalValue?: { amount?: string; currency?: string };
}

export interface AllegroPaymentRefundsResponse {
  refunds?: AllegroPaymentRefundWire[];
}

export const ALLEGRO_REFUND_SETTLED_STATUS = 'SUCCESS';
