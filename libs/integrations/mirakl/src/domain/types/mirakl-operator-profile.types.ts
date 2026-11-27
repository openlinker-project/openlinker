/**
 * Mirakl Operator Profile
 *
 * Every Mirakl marketplace (Empik, Decathlon, Leroy Merlin, ...) runs the same
 * Seller API, so the plugin code is shared and each marketplace is described
 * by a data-only profile. A profile becomes its own adapter, platform type and
 * connection type, which is how operators see these marketplaces: as Empik,
 * not as "Mirakl".
 *
 * The profile carries only what the first operator actually needs. Fields for
 * order and offer rules are added by the issues that read them, so nothing here
 * is speculative (ADR-088).
 *
 * @module libs/integrations/mirakl/src/domain/types
 */
import type { RefundReason } from '@openlinker/core/orders';
import type { TaxonomyOwner } from '@openlinker/core/listings';
import type { MiraklEnvironment } from './mirakl-connection.types';

export interface MiraklOperatorProfile {
  /** Registry key, e.g. `empik.mirakl.v1`. */
  readonly adapterKey: string;
  /** `connection.platformType`, e.g. `empik`. */
  readonly platformType: string;
  /** Manifest display name, e.g. `Empik Marketplace`. */
  readonly displayName: string;
  /** Short label used as the prefix of validation errors, e.g. `Empik`. */
  readonly brand: string;
  /** Manifest version. */
  readonly version: string;
  /**
   * Seller API origin per environment, https, no path. Request paths carry the
   * `/api/...` prefix themselves. These are the only hosts the client will call.
   */
  readonly baseUrls: Readonly<Record<MiraklEnvironment, string>>;
  /**
   * OR74 document type an issued invoice is uploaded as. Operators configure
   * their own order document types (DO01); Empik lists `CUSTOMER_INVOICE`.
   */
  readonly invoiceDocumentTypeCode: string;
  /**
   * The category tree a connection reads, per environment (ADR-037). Staging
   * runs its own catalogue, so it is a tree of its own.
   */
  readonly taxonomyOwners: Readonly<Record<MiraklEnvironment, TaxonomyOwner>>;
  /**
   * The operator's refund reason code (RE02 `REFUND`) for each OpenLinker
   * refund reason. Operators configure their own codes.
   */
  readonly refundReasonCodes: Readonly<Record<RefundReason, string>>;
  /**
   * The operator's card attribute codes OpenLinker fills itself when it
   * creates a catalogue card (P41, #4278). Operators name these attributes
   * their own way; Empik's were read from PM11 on staging.
   */
  readonly cardAttributes: MiraklCardAttributeCodes;
}

/** Card attributes filled from the offer command rather than typed in. */
export interface MiraklCardAttributeCodes {
  /** The category (hierarchy code) the card is created in. */
  readonly category: string;
  /** The seller's own product code; also how an error report names a line. */
  readonly catalogCode: string;
  /** Longest product code the operator accepts (Empik: 26, from its P44 report). */
  readonly catalogCodeMaxLength: number;
  readonly title: string;
  readonly description: string;
  readonly ean: string;
  readonly mainImage: string;
  /** Further images: `${extraImagePrefix}1` ... `${extraImagePrefix}${extraImageCount}`. */
  readonly extraImagePrefix: string;
  readonly extraImageCount: number;
  /** VAT rate, a LIST whose labels read like `23%`. */
  readonly vat: string;
  /** Groups the cards of one product's variants. */
  readonly variantGroup: string;
  /** Yes/no LIST: the card is a set of several products. */
  readonly bundle: string;
  /** Free text: what a set contains, where the category has it. */
  readonly bundleContents: string;
  /** Integer: units of one product in the pack (a multipack). */
  readonly packQuantity: string;
}
