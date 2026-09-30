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
 */
export const BenchReplaceLabelRefusalReasonValues = [
  'cannot-cancel',
  'already-handed-over',
  'parcel-completed',
  'no-label',
  'recipient-unavailable',
  'parcel-size-unknown',
  'replace-in-progress',
] as const;
export type BenchReplaceLabelRefusalReason = (typeof BenchReplaceLabelRefusalReasonValues)[number];

export type BenchReplaceLabelResult =
  | { readonly outcome: 'replaced'; readonly cancelledShipmentId: string; readonly newShipmentId: string; readonly cancelledAfterDispatch: boolean }
  | { readonly outcome: 'refused'; readonly reason: BenchReplaceLabelRefusalReason }
  | {
      /** The old label is void and no new one was bought: the office must buy one. */
      readonly outcome: 'cancelled-not-replaced';
      readonly cancelledShipmentId: string;
      readonly cancelledAfterDispatch: boolean;
    };
