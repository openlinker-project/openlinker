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
  /** The checkout form the refund belongs to. */
  order?: { id?: string };
  createdAt?: string;
  totalValue?: { amount?: string; currency?: string };
}

export interface AllegroPaymentRefundsResponse {
  refunds?: AllegroPaymentRefundWire[];
}

/** Page size sent to the endpoint; Allegro's documented maximum for this list. */
export const ALLEGRO_REFUND_PAGE_LIMIT = 100;
/** Hard stop so a misbehaving endpoint can never loop the sync job. */
export const ALLEGRO_REFUND_MAX_PAGES = 10;

export const ALLEGRO_REFUND_SETTLED_STATUS = 'SUCCESS';
