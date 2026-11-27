/**
 * Mirakl Order Wire Types
 *
 * The parts of a Mirakl OR11 order the order source reads, and the OR21
 * acceptance body. Every field is optional on purpose: the shape comes from the
 * Mirakl Seller API spec and has not yet been seen on a real Empik order, so
 * the mapper must cope with any field being absent.
 *
 * @module libs/integrations/mirakl/src/domain/types
 */

/**
 * Order states the Mirakl spec documents. Kept open (`string`) on the wire
 * type, because an operator can add states and an unknown one must not break
 * the read.
 */
export const MiraklOrderStateValues = [
  'STAGING',
  'WAITING_ACCEPTANCE',
  'WAITING_DEBIT',
  'WAITING_DEBIT_PAYMENT',
  'SHIPPING',
  'SHIPPED',
  'TO_COLLECT',
  'RECEIVED',
  'CLOSED',
  'REFUSED',
  'CANCELED',
] as const;
export type MiraklOrderState = (typeof MiraklOrderStateValues)[number];

/** One custom field on an order or order line. `value` is typed by `type`. */
export interface MiraklAdditionalField {
  readonly code?: string;
  readonly type?: string;
  readonly value?: unknown;
}

export interface MiraklTax {
  readonly code?: string;
  readonly rate?: number;
  readonly amount?: number;
}

export interface MiraklAddress {
  readonly firstname?: string;
  readonly lastname?: string;
  readonly company?: string;
  readonly street_1?: string;
  readonly street_2?: string;
  readonly city?: string;
  readonly zip_code?: string;
  readonly state?: string;
  readonly country?: string;
  readonly country_iso_code?: string;
  readonly phone?: string;
  readonly phone_secondary?: string;
  readonly additional_info?: string;
}

export interface MiraklCustomer {
  readonly customer_id?: string;
  readonly firstname?: string;
  readonly lastname?: string;
  readonly billing_address?: MiraklAddress;
  readonly shipping_address?: MiraklAddress;
  readonly organization?: {
    readonly tax_identification_number?: string;
  };
}

export interface MiraklProductMedia {
  readonly media_url?: string;
  readonly type?: string;
}

export interface MiraklOrderLine {
  readonly order_line_id?: string;
  readonly order_line_state?: string;
  readonly offer_id?: number;
  readonly offer_sku?: string;
  readonly product_sku?: string;
  readonly product_title?: string;
  readonly quantity?: number;
  /** Unit price of the offer. */
  readonly price_unit?: number;
  /** Line price without shipping (`price_unit * quantity`). */
  readonly price?: number;
  readonly shipping_price?: number;
  readonly taxes?: readonly MiraklTax[];
  readonly shipping_taxes?: readonly MiraklTax[];
  readonly product_medias?: readonly MiraklProductMedia[];
  /** Refunds already made on this line (OR28, or by the operator). */
  readonly refunds?: readonly MiraklOrderRefund[];
}

/** One refund on an order line, as OR11 returns it. */
export interface MiraklOrderRefund {
  readonly id?: string;
  /** Product part of the refund. */
  readonly amount?: number;
  readonly shipping_amount?: number;
  readonly currency_iso_code?: string;
  readonly reason_code?: string;
  readonly created_date?: string;
  /** When the money was paid back; absent until it was. */
  readonly transaction_date?: string;
  /** `WAITING_REFUND_TAX_CONFIRMATION`, `WAITING_REFUND`, `WAITING_REFUND_PAYMENT` or `REFUNDED`. */
  readonly refund_state?: string;
  /** Deprecated twin of `refund_state`, read when that is absent. */
  readonly state?: string;
}

export interface MiraklOrder {
  readonly order_id?: string;
  readonly commercial_id?: string;
  readonly order_state?: string;
  readonly created_date?: string;
  readonly last_updated_date?: string;
  readonly customer_debited_date?: string;
  readonly currency_iso_code?: string;
  /** `TAX_INCLUDED` or `TAX_EXCLUDED`. */
  readonly order_tax_mode?: string;
  readonly price?: number;
  readonly shipping_price?: number;
  readonly total_price?: number;
  readonly fully_refunded?: boolean;
  readonly shipping_type_code?: string;
  readonly shipping_type_label?: string;
  readonly shipping_pudo_id?: string;
  readonly shipping_deadline?: string;
  /** The order's one tracking number, set by OR23 or in the operator panel. */
  readonly shipping_tracking?: string;
  /** SH21 carrier code of that tracking number, when a known carrier was named. */
  readonly shipping_carrier_code?: string;
  /** Carrier name as Mirakl shows it (the SH21 label or a free-text name). */
  readonly shipping_company?: string;
  readonly shipping_tracking_url?: string;
  readonly customer?: MiraklCustomer;
  readonly customer_notification_email?: string;
  readonly order_additional_fields?: readonly MiraklAdditionalField[];
  readonly order_lines?: readonly MiraklOrderLine[];
}

/** OR11 page envelope. */
export interface MiraklOrdersPage {
  readonly orders?: readonly MiraklOrder[];
  readonly total_count?: number;
}

/** OR21 body: a decision for every line. */
export interface MiraklAcceptOrderBody {
  readonly order_lines: ReadonlyArray<{ readonly id: string; readonly accepted: boolean }>;
}

/** What one acceptance pass did, logged once per poll. */
export interface MiraklAcceptanceSummary {
  readonly accepted: number;
  readonly alreadyHandled: number;
  readonly failed: number;
}

/**
 * OR23 body. Either a known SH21 `carrier_code`, or a free-text
 * `carrier_name` (with an optional `carrier_url`) for a carrier the operator
 * does not list; never both.
 */
export type MiraklTrackingBody =
  | { readonly carrier_code: string; readonly tracking_number: string }
  | {
      readonly carrier_name: string;
      readonly carrier_url?: string;
      readonly tracking_number: string;
    };

/** One SH12 shipping type. */
export interface MiraklShippingType {
  readonly code?: string;
  readonly label?: string;
}

/** One OR72 order document. */
export interface MiraklOrderDocument {
  readonly id?: number | string;
  readonly order_id?: string;
  readonly file_name?: string;
  readonly type?: string;
}

/** OR74 answer: per-file outcome, errors listed separately. */
export interface MiraklDocumentUploadResult {
  readonly errors_count?: number;
  readonly order_documents?: ReadonlyArray<{
    readonly file_name?: string;
    readonly type_code?: string;
  }>;
  readonly document_errors?: ReadonlyArray<{
    readonly file_name?: string;
    readonly message?: string;
    readonly code?: string;
  }>;
}
