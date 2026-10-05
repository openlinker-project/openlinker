/**
 * Bench label replacement types (#3654)
 *
 * The parcel a packer may specify when the label on the box is the wrong size.
 * Deliberately parcel data ONLY: there is no recipient, address or shipment id
 * anywhere in these shapes, so nothing a caller sends can steer where a label
 * is addressed or which shipment is voided.
 *
 * @module apps/api/src/bench/application/types
 */

/** Exactly one of three shapes; the service resolves "weight only" against connection config. */
export type BenchReplaceLabelParcel =
  | { readonly kind: 'template'; readonly template: string }
  | {
      readonly kind: 'box';
      readonly lengthMm: number;
      readonly widthMm: number;
      readonly heightMm: number;
      readonly weightGrams: number;
    }
  | { readonly kind: 'weight'; readonly weightGrams: number };

export interface BenchReplaceLabelInput {
  readonly workId: string;
  readonly parcel: BenchReplaceLabelParcel;
  /** The verified token's user, never the body's. */
  readonly actorUserId: string;
}

/**
 * Why a replacement was refused. Every one of these has NO side effect: the
 * checks all run before the old label is cancelled.
 *
 * `cannot-cancel` is STRUCTURAL: the carrier connection does not offer a cancel
 * at all, so retrying will not help. `adapter-unresolved` is TRANSIENT: the
 * connection could not be resolved right now (disabled, credentials failing),
 * and the same request may succeed once the office fixes it. The split is the
 * one #1947 made on the relay path, for the same reason: a packer told the
 * carrier cannot do this stops trying, one told the connection is unavailable
 * escalates.
 */
export const BenchReplaceLabelRefusalReasonValues = [
  'cannot-cancel',
  'adapter-unresolved',
  'already-handed-over',
  'parcel-completed',
  'no-label',
  'recipient-unavailable',
  'parcel-size-unknown',
  'replace-in-progress',
] as const;
export type BenchReplaceLabelRefusalReason = (typeof BenchReplaceLabelRefusalReasonValues)[number];

/**
 * Whether the old label is KNOWN to be void.
 *
 * - `confirmed` - the cancel returned; the old label is void.
 * - `in-doubt` - the cancel call itself threw. It crossed the carrier boundary,
 *   so OpenLinker does not know whether the carrier voided the label, and holds
 *   that as in doubt rather than resolving it by a guess (the ADR-042 decision 7
 *   vocabulary). Nothing is re-bought in this state: buying while the old label
 *   may still be live risks two paid labels for one box.
 *
 * Either way the old label must not be used.
 */
export const BenchLabelVoidStateValues = ['confirmed', 'in-doubt'] as const;
export type BenchLabelVoidState = (typeof BenchLabelVoidStateValues)[number];

export type BenchReplaceLabelResult =
  | {
      readonly outcome: 'replaced';
      readonly cancelledShipmentId: string;
      readonly newShipmentId: string;
      readonly cancelledAfterDispatch: boolean;
      /**
       * The connection's configured size the new label was bought with when the
       * packer kept the current size (weight only); `null` when the packer named
       * a size or measured the box. A shipment does not persist its parcel, so
       * "keep the size" is really "use the configured template" - reported so
       * the bench can name the size it bought rather than leave it unnamed.
       */
      readonly keptTemplate: string | null;
    }
  | { readonly outcome: 'refused'; readonly reason: BenchReplaceLabelRefusalReason }
  | {
      /** The old label is void (or may be) and no new one was bought: the office must buy one. */
      readonly outcome: 'cancelled-not-replaced';
      readonly cancelledShipmentId: string;
      readonly cancelledAfterDispatch: boolean;
      readonly voidState: BenchLabelVoidState;
      /** As on `replaced`: the size the re-buy would have used. */
      readonly keptTemplate: string | null;
    };
