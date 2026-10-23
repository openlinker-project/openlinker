/**
 * Shoper Connection Config Types
 *
 * Shape of the `Connection.config` JSONB blob for a Shoper connection.
 * Validated at save time by `ShoperConnectionConfigShapeValidatorAdapter`;
 * the rules live in `parseShoperBaseUrl` so the validator and the connection
 * tester cannot disagree about what a valid value is.
 *
 * @module libs/integrations/shoper/src/domain/types
 */

/**
 * Ids of rows in the shop's own `/shippings`, `/payments` and `/statuses`, used
 * when no operator mapping resolves one. Shoper requires all three on an order
 * and has no catch-all, so there is no value OpenLinker could guess.
 */
export interface ShoperOrderDefaults {
  readonly shippingId?: number;
  readonly paymentId?: number;
  readonly statusId?: number;
  /**
   * The shipping method a parcel is written under when OpenLinker records a
   * dispatch. Shoper refuses `POST /parcels` for a carrier-integrated method
   * (InPost, DPD, ...), so the order's own method is often unusable; this names
   * a non-integrated one to use instead.
   */
  readonly parcelShippingId?: number;
  /** The status a `cancelled` writeback moves the order to; else the first active cancelled-type status. */
  readonly cancelledStatusId?: number;
  /** The status an `in-progress` writeback moves the order to; else the first active in-progress-type status. */
  readonly inProgressStatusId?: number;
}

export interface ShoperConnectionConfig {
  /**
   * The shop's own host, e.g. `xxxxx.shoparena.pl`. An `https://` URL naming
   * only that host is accepted too and normalised to the bare host. HTTPS is
   * the only transport: the Bearer token travels on every request.
   */
  readonly baseUrl: string;
  /** Fallback ids for the three order fields Shoper requires; see `ShoperOrderDefaults`. */
  readonly defaults?: ShoperOrderDefaults;
  /**
   * OpenLinker's public URL as the SHOP sees it (#3644). The webhook install posts
   * `${openlinkerCallbackBaseUrl}/webhooks/shoper/<connectionId>` to Shoper, so it
   * must be reachable from the shop. Same wire key PrestaShop and WooCommerce read.
   */
  readonly openlinkerCallbackBaseUrl?: string;
  /** Written by the webhook install: true once the shop holds the webhook. */
  readonly webhooksConfigured?: boolean;
}
