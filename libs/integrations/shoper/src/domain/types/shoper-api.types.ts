/**
 * Shoper API Types
 *
 * Wire shapes the transport reads. Shoper serializes almost every number as a
 * STRING (`"stock": "77"`, `"count": "36"`), with a few real numbers mixed in
 * (`pages`, `page`, `categories: [38]`), so numeric fields here are typed as
 * the string they arrive as and parsed explicitly by the mapper. Only the
 * fields OpenLinker reads are declared; Shoper sends many more.
 *
 * Shapes were captured from a live trial shop (see
 * `docs/plans/implementation-plan-shoper-product-master-read.md`).
 *
 * @module libs/integrations/shoper/src/domain/types
 */

/**
 * Error envelope Shoper returns on 4xx (SPIKE-3638 C3, C4, M6), e.g.
 * `{"error":"unauthorized_client","error_description":"Provided access token is invalid"}`
 * or `{"error":"invalid_request","error_description":"Resource not found"}`.
 */
export interface ShoperErrorBody {
  readonly error?: string;
  readonly error_description?: string;
}

/**
 * Envelope of every collection endpoint. Paging is PAGE-based, not offset-based.
 * `count` is a string, `pages` and `page` are numbers.
 */
export interface ShoperPageEnvelope<T> {
  readonly count: string;
  readonly pages: number;
  readonly page: number;
  readonly list: readonly T[];
}

/** Per-language text of a product. `isdefault` is unreliable (`"0"` on every language). */
export interface ShoperProductTranslation {
  readonly name?: string | null;
  readonly description?: string | null;
  readonly short_description?: string | null;
  /**
   * Per-language visibility, the panel's "Aktywność". Written as `1` / `0`
   * (`shoper-product-write.types.ts`); read back tolerantly, since Shoper
   * serializes flags as strings elsewhere (`"1"` on categories).
   */
  readonly active?: string | number | boolean | null;
}

export interface ShoperMainImage {
  readonly unic_name: string;
  readonly extension: string;
}

/**
 * A `GET /product-images` row (only what the mapper reads). Listing one
 * product's images takes the JSON filter form (`filters={"product_id":93}`);
 * the bracket form answers 500 on this resource (verified live, 7 Oct 2026).
 * `main` is `"1"` on the product's main image, `order` is its gallery position.
 */
export interface ShoperProductImage extends ShoperMainImage {
  readonly gfx_id: string;
  readonly product_id: string;
  readonly main?: string | null;
  readonly order?: string | null;
  /** `"1"` for an image the shop does not show in the product gallery. */
  readonly hidden?: string | null;
}

/**
 * A `product-stocks` row: the real VARIANT grain (SPIKE-3638 M1). Every Shoper
 * product has at least one, with a real `stock_id`.
 */
export interface ShoperStock {
  readonly stock_id: string;
  readonly product_id: string;
  readonly price: string | null;
  readonly stock: string | null;
  readonly weight: string | null;
  readonly active: string | null;
  readonly default: string | null;
  readonly code: string | null;
  readonly ean: string | null;
  /**
   * How this row's `price` relates to the base row's price (Shoper's own
   * `ProductStock::PRICE_TYPE_*`): `0` keep the base price (`price` is then
   * meaningless, `"0.00"` on a live shop), `1` own price, `2` base plus `price`,
   * `3` base minus `price`. Optional: rows captured before the field was read
   * lack it, and those keep reading `price` as the row's own price.
   */
  readonly price_type?: string | null;
  /** Same codes as `price_type`, applied to `weight` (`ProductStock::WEIGHT_TYPE_*`). */
  readonly weight_type?: string | null;
  /** Variant option values; see {@link ShoperStockOptions}. */
  readonly options: ShoperStockOptions;
}

/**
 * `options` of a `product-stocks` row, verified live (product 127, 5 Oct 2026):
 * `{ "<option_id>": "<ovalue_id>" }` - IDS ONLY, the names live in `/options` and
 * `/option-values`. A stock with no options carries `[]` (PHP's empty array), not `{}`.
 */
export type ShoperStockOptions = Readonly<Record<string, string>> | readonly [];

/** A `GET /options/:id` row (an option such as "Kolor"); only what the mapper reads. */
export interface ShoperOption {
  readonly option_id: string;
  readonly translations: Readonly<Record<string, { readonly name?: string | null }>>;
}

/** A `GET /option-values` row (a value such as "biszkoptowy"); only what the mapper reads. */
export interface ShoperOptionValue {
  readonly ovalue_id: string;
  readonly option_id: string;
  readonly translations: Readonly<Record<string, { readonly value?: string | null }>>;
}

/** A `products` row. The list endpoint embeds the same shape, `stock` included. */
export interface ShoperProduct {
  readonly product_id: string;
  readonly tax_id: string | null;
  readonly code: string | null;
  readonly ean: string | null;
  readonly category_id: string | null;
  readonly categories: readonly number[];
  readonly translations: Readonly<Record<string, ShoperProductTranslation>>;
  readonly main_image: ShoperMainImage | null;
  readonly stock: ShoperStock | null;
  /** Ids of the product's non-default stocks (live: `[217, 218]`) - not option data. */
  readonly options: readonly number[];
  /**
   * GPSR references (see {@link ShoperProductSafetyInformation}). Optional
   * because it is modelled from the published API schema, not yet seen on a
   * live product payload: an answer without it means "not reported".
   */
  readonly safety_information?: ShoperProductSafetyInformation | null;
}

/**
 * A product's GPSR references, per Shoper's published schema: ids into the
 * `product-safety-producers` / `-responsibles` / `-importers` registries
 * (nullable int32 strings) and `gpsr_certificates` into
 * `product-safety-certificates`. The records themselves are separate reads.
 * Ids are accepted as string or number because the schema says string while
 * the certificate list says integer.
 */
export interface ShoperProductSafetyInformation {
  readonly gpsr_producer_id?: string | number | null;
  readonly gpsr_responsible_id?: string | number | null;
  readonly gpsr_importer_id?: string | number | null;
  readonly gpsr_certificates?: readonly (string | number)[] | null;
}

/**
 * A row of `product-safety-producers`, `-responsibles` or `-importers` - the
 * three share every field the mapper reads; only the id key differs (and
 * importers carry no `contact_form_url`). `name` is the public name printed on
 * a safety declaration; `internal_name` is the merchant's own label and is
 * never used. Modelled from the published schema, hence every field optional.
 */
export interface ShoperSafetyPartyRecord {
  readonly gpsr_producer_id?: string | number | null;
  readonly gpsr_responsible_id?: string | number | null;
  readonly gpsr_importer_id?: string | number | null;
  readonly name?: string | null;
  readonly internal_name?: string | null;
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly contact_form_url?: string | null;
  readonly street1?: string | null;
  readonly street2?: string | null;
  readonly postcode?: string | null;
  /** A city name, or (per the schema) a GeolocationSubregion id. */
  readonly city?: string | null;
  readonly country_code?: string | null;
}

/** A `product-safety-certificates` row: a name plus per-locale descriptions. */
export interface ShoperSafetyCertificateRecord {
  readonly gpsr_certificate_id?: string | number | null;
  readonly name?: string | null;
  readonly translations?: Readonly<Record<string, { readonly description?: string | null }>> | null;
}

/** Per-language text of a category. */
export interface ShoperCategoryTranslation {
  readonly name?: string | null;
  readonly active?: string | null;
}

/** A `GET /categories` row: carries the TEXT, not the structure. */
export interface ShoperCategory {
  readonly category_id: string;
  readonly translations: Readonly<Record<string, ShoperCategoryTranslation>>;
}

/** A `GET /categories-tree` node: carries the STRUCTURE only (ids, no names). */
export interface ShoperCategoryTreeNode {
  readonly id: number;
  readonly children: readonly ShoperCategoryTreeNode[];
}

/**
 * A predefined value of a select-type attribute, as embedded in the attribute's
 * `options`. NOT live-verified: modelled from Shoper's REST documentation, so
 * every field is optional and ids are accepted as string or number.
 */
export interface ShoperAttributeOption {
  readonly option_id?: string | number | null;
  readonly value?: string | null;
  readonly order?: string | number | null;
}

/**
 * A `GET /attributes` / `GET /attributes/:id` row: a product attribute (e.g.
 * "Materiał"), which belongs to an attribute GROUP (`/attribute-groups`) that
 * may be bound to categories. `type` is documented as `0` text field, `1`
 * checkbox, `2` select; only a select carries `options`. NOT live-verified:
 * modelled from Shoper's REST documentation, hence the tolerant shapes.
 */
export interface ShoperAttribute {
  readonly attribute_id?: string | number | null;
  readonly attribute_group_id?: string | number | null;
  readonly name?: string | null;
  readonly type?: string | number | null;
  readonly options?: readonly ShoperAttributeOption[] | null;
}

/**
 * A `GET /attribute-groups` row. A group scopes its attributes to categories:
 * live-verified (2026-10-23) that an attribute whose group does not list the
 * product's category is ACCEPTED by `PUT /products/:id` and silently not stored,
 * so `categories` is what decides whether an attribute is worth sending.
 */
export interface ShoperAttributeGroup {
  readonly attribute_group_id?: string | number | null;
  readonly name?: string | null;
  readonly categories?: readonly (string | number)[] | null;
}

/**
 * A `GET /taxes` row. Three live rows share `value: "0"` (`0%`, `zw.`, `np.`),
 * so the NAME is what identifies the rate, not `value`.
 */
export interface ShoperTax {
  readonly tax_id: string;
  readonly value: string;
  readonly name: string;
}

/** The slice of `GET /application-config` the adapter reads. */
export interface ShoperApplicationConfig {
  readonly default_language_name: string;
  readonly default_currency_name: string;
  readonly locale_default_weight: string;
  /** IANA zone the shop's naive order timestamps are written in (`Europe/Warsaw` on the live shop). */
  readonly locale_timezone?: string | null;
  /**
   * Multi-warehouse module (a paid Premium feature, SPIKE-3638 M10). A real JSON
   * boolean on the live shop (`false`). Only an explicit "off" (`false`, `0`,
   * `"0"`, `"false"`) reads as off; anything else - including a missing field -
   * reads as on, so stock is refused rather than published on a guess.
   */
  readonly warehouses_enabled: boolean | string | number;
  /**
   * Whether the shop removes stock itself when an order line is created ("1" on
   * the trial shop). Absent or unrecognised reads as ON, the shop default.
   */
  readonly shopping_update_stock_on_buy?: boolean | string | number;
}

/** A `GET /users` row (the slice the customer provisioner reads). */
export interface ShoperUser {
  readonly user_id: string;
  readonly email: string;
  readonly firstname?: string | null;
  readonly lastname?: string | null;
}

/** Body of `POST /users`. */
export interface ShoperUserCreateRequest {
  readonly email: string;
  readonly firstname: string;
  readonly lastname: string;
  readonly active: 1;
}

/** A `GET /shippings` row (the slice the order flow reads). */
export interface ShoperShipping {
  readonly shipping_id: string;
  /** The shipping method's own tax; becomes the order's `shipping_tax_id`. */
  readonly tax_id: string;
}

/** A `GET /currencies` row. */
export interface ShoperCurrency {
  readonly currency_id: string;
  readonly name: string;
}

/** Billing / delivery address of `POST /orders`. */
export interface ShoperOrderAddress {
  readonly firstname: string;
  readonly lastname: string;
  readonly company: string;
  readonly street1: string;
  readonly street2: string;
  readonly city: string;
  readonly postcode: string;
  readonly state: string;
  readonly country_code: string;
  readonly phone: string;
  readonly tax_identification_number: string;
}

/** Body of `POST /orders` (the six required fields of SPIKE-3638 O1, plus context). */
export interface ShoperOrderCreateRequest {
  readonly user_id: number;
  readonly email: string;
  readonly status_id: number;
  readonly payment_id: number;
  readonly shipping_id: number;
  readonly shipping_tax_id: number;
  readonly shipping_cost: number;
  readonly currency_id: number;
  /** Amount already paid; equal to the order sum makes Shoper read it as paid. Omitted when unknown. */
  readonly paid?: number;
  readonly billing_address: ShoperOrderAddress;
  readonly delivery_address: ShoperOrderAddress;
  /** Private note: the OpenLinker order id, for forensic recovery only (NOT a dedup key). */
  readonly notes_priv?: string;
}

/** Body of `POST /order-products`. `price` is GROSS and `tax` is the tax NAME. */
export interface ShoperOrderProductCreateRequest {
  readonly order_id: number;
  readonly product_id: number;
  readonly stock_id: number;
  readonly price: number;
  readonly quantity: number;
  readonly name: string;
  readonly tax: string;
  readonly tax_value: number;
}

/** The slice of a `GET /orders` row the duplicate guard reads. */
export interface ShoperOrderRef {
  readonly order_id: string;
  readonly notes_priv?: string | null;
  /** The order's current status; compared with the one OpenLinker created it in. */
  readonly status_id?: string | number | null;
}

/**
 * The slice of `GET /orders/:id` the status writeback reads: the shipping method
 * the order uses and the status it is in.
 */
export interface ShoperOrderShipping {
  readonly order_id: string | number;
  readonly shipping_id?: string | number | null;
  readonly status_id?: string | number | null;
}

/**
 * A `GET /shippings` row as the parcel writeback reads it. `engine` names what
 * drives the method: `personal` for a plain, non-integrated one (verified live on
 * the trial shop, id 8), a carrier module for InPost, DPD and the like.
 */
export interface ShoperShippingRow {
  readonly shipping_id: string | number;
  readonly engine?: string | null;
  /** `"1"` / `"0"` on the wire like every other flag; absent reads as active. */
  readonly active?: string | number | boolean | null;
}

/** Row of `GET /parcels`. `shipping_code` is the carrier tracking number. */
export interface ShoperParcel {
  readonly parcel_id: string | number;
  readonly order_id: string | number;
  readonly shipping_code?: string | null;
  /** The shipping method the parcel was written under; the fulfilment readback reports it as the carrier id. */
  readonly shipping_id?: string | number | null;
  /** Whether the parcel has been sent; a flag like every other (`"1"` / `true`). */
  readonly sent?: string | number | boolean | null;
  /** When it was sent, naive and shop-local; absent or null while unsent. */
  readonly send_date?: string | null;
}

/**
 * Body of `POST /parcels` (#3643). No `products[]`: Shoper then ships exactly the
 * quantity still unshipped on each line (#3638), i.e. the whole order the first time.
 * Creating the parcel advances the order status per the shop's own
 * `shopping_parcel_send_status_id`.
 */
export interface ShoperParcelCreateRequest {
  readonly order_id: number;
  readonly shipping_id: number;
  readonly shipping_code?: string;
  readonly sent: true;
}

/** Body of `PUT /orders/:id` that moves an order to another status (live-verified for cancel). */
export interface ShoperOrderStatusUpdate {
  readonly status_id: number;
}

/**
 * Body of `PUT /parcels/:id` that attaches a tracking number arriving after the
 * parcel. `sent` is left out for a parcel that is already sent: Shoper answers
 * 400 `parcel_already_sent` to any write naming the flag then, while the code on
 * its own is accepted (live-verified 2026-10-23).
 */
export interface ShoperParcelTrackingUpdate {
  readonly shipping_code: string;
  readonly sent?: true;
}

/** Row of `/shippings`, `/payments` or `/statuses`: the id plus per-language labels. */
export interface ShoperOptionRow {
  readonly shipping_id?: string;
  readonly payment_id?: string;
  readonly status_id?: string;
  readonly name?: string | null;
  readonly translations?: Readonly<Record<string, { readonly name?: string | null; readonly title?: string | null }>>;
}

/**
 * A `GET /orders` / `GET /orders/:id` row as an ORDER SOURCE reads it (live-verified
 * 6 Oct 2026). The list endpoint returns the whole order, addresses and `notes_priv`
 * included, but NOT its lines: those are `order-products` rows. Every number is a
 * string; timestamps are naive and in the shop's own time zone.
 */
export interface ShoperOrderRow {
  readonly order_id: string;
  readonly user_id?: string | number | null;
  /** Placement time, `YYYY-MM-DD HH:MM:SS`, shop-local. */
  readonly date?: string | null;
  /** Last status change, same format. The only update marker the order carries. */
  readonly status_date?: string | null;
  readonly status_id?: string | number | null;
  readonly sum?: string | number | null;
  /** Amount already paid; equals `sum` once the order is paid. */
  readonly paid?: string | number | null;
  readonly shipping_id?: string | number | null;
  /**
   * Pickup point the buyer chose at checkout (`"POP-WAW579"`); absent, blank or null
   * for a courier order.
   */
  readonly pickup_point?: string | null;
  readonly shipping_cost?: string | number | null;
  /** Percent of the shipping method's tax (`23`). */
  readonly shipping_tax_value?: string | number | null;
  readonly payment_id?: string | number | null;
  readonly currency_id?: string | number | null;
  readonly email?: string | null;
  readonly notes_priv?: string | null;
  readonly is_paid?: boolean | null;
  readonly is_cash_on_delivery?: boolean | null;
  readonly order_url?: string | null;
  readonly billing_address?: ShoperOrderSourceAddress | null;
  readonly delivery_address?: ShoperOrderSourceAddress | null;
}

/** Address of an order READ from Shoper (the create body has the same fields minus `country`). */
export interface ShoperOrderSourceAddress {
  readonly firstname?: string | null;
  readonly lastname?: string | null;
  readonly company?: string | null;
  readonly street1?: string | null;
  readonly street2?: string | null;
  readonly city?: string | null;
  readonly postcode?: string | null;
  readonly state?: string | null;
  readonly country_code?: string | null;
  readonly phone?: string | null;
  readonly tax_identification_number?: string | null;
}

/** An `order-products` row. `price` is GROSS; `tax` is the tax NAME (`23%`), `tax_value` its percent. */
export interface ShoperOrderLineRow {
  readonly id: string;
  readonly order_id: string;
  readonly product_id?: string | number | null;
  readonly stock_id?: string | number | null;
  readonly price?: string | number | null;
  readonly quantity?: string | number | null;
  readonly name?: string | null;
  /** The product's own code (SKU). */
  readonly code?: string | null;
  readonly ean?: string | null;
  readonly tax?: string | null;
  readonly tax_value?: string | number | null;
}

/** A `GET /statuses` row: `type` is the coarse lifecycle (1 new, 2 processing, 3 shipped, 4 terminal). */
export interface ShoperStatusRow {
  readonly status_id: string;
  readonly type?: string | number | null;
  /** Whether the shop offers the status (`"1"` / `"0"`). */
  readonly active?: string | number | boolean | null;
  /** Per-language labels (`pl_PL: { name: 'zwrócone' }`); the row's own `name` is null on the live shop. */
  readonly translations?: Readonly<Record<string, { readonly name?: string | null }>> | null;
}
