/**
 * Mirakl Card Types
 *
 * A catalogue card OpenLinker creates on a Mirakl operator before it can list
 * an offer there (#4278, part 2). On Mirakl an offer must point to a card; when
 * P31 finds none for the EAN, the card is imported with P41, the operator
 * reviews it, and only once the card is in the catalogue can OF24 create the
 * offer. The request is kept in `mirakl_offer_writes` (kind `card`) with this
 * shape as its JSON `value`, so the later OF24 sends exactly what the operator
 * submitted.
 *
 * @module libs/integrations/mirakl/src/domain/types
 */

/** One P41 line: card attribute code -> value, as the file carries it. */
export type MiraklCardRow = Readonly<Record<string, string>>;

/** The OF24 offer line sent once the card is in the catalogue. */
export interface MiraklOfferLine {
  readonly shop_sku: string;
  readonly product_id: string;
  readonly product_id_type: 'EAN';
  readonly price: string;
  readonly quantity: number;
  readonly state_code: string;
  readonly update_delete: 'update';
  readonly leadtime_to_ship?: number;
  readonly logistic_class?: string;
  readonly offer_additional_fields: ReadonlyArray<{
    readonly code: string;
    readonly value: string;
  }>;
}

export interface MiraklCardRequest {
  readonly ean: string;
  readonly card: MiraklCardRow;
  readonly offer: MiraklOfferLine;
}
