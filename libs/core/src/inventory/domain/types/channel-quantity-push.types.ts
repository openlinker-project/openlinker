/**
 * Channel quantity push types (#4062)
 *
 * One row per quantity OpenLinker tried to write to one channel listing: what
 * it sent, whether the channel took it, and the observation the quantity came
 * from. It answers the operator's question "the channel shows the wrong
 * number - did we send the wrong one, send nothing, or was it refused?",
 * which the stock movement ledger cannot, because a movement records the
 * master's change and not what happened downstream.
 *
 * Append-only and best-effort: recording a push never fails or retries the
 * write it describes.
 *
 * @module libs/core/src/inventory/domain/types
 */

/**
 * - `sent`: the channel accepted the write (for an asynchronous channel such
 *   as Allegro, accepted for processing - ADR-067 § Amendment (#2621)).
 * - `failed`: the write was attempted, or suppressed, and did not land.
 * - `skipped`: nothing was written because the channel already carries a
 *   newer quantity (the #2617 write-order guard).
 */
export const ChannelQuantityPushOutcomeValues = ['sent', 'failed', 'skipped'] as const;
export type ChannelQuantityPushOutcome = (typeof ChannelQuantityPushOutcomeValues)[number];

export interface ChannelQuantityPush {
  readonly id: string;
  readonly connectionId: string;
  /** The channel's own listing id: an offer, or a shop product. */
  readonly externalOfferId: string;
  /** Null when the write did not name a variant (the stale-offer pause, legacy jobs). */
  readonly productVariantId: string | null;
  /** The quantity sent after publish controls; null when none could be resolved. */
  readonly quantity: number | null;
  readonly outcome: ChannelQuantityPushOutcome;
  readonly errorCode: string | null;
  readonly message: string | null;
  /**
   * The stock observation the quantity expresses: the inventory row's
   * `updatedAt`, which is also the stock movement's `occurredAt`. Null for a
   * write with no observation.
   */
  readonly observedAt: Date | null;
  readonly pushedAt: Date;
}

export type AppendChannelQuantityPushInput = Omit<ChannelQuantityPush, 'id'>;

/** The last push OpenLinker made to one channel for one variant. */
export interface LastChannelQuantityPush {
  readonly productVariantId: string;
  readonly connectionId: string;
  readonly quantity: number | null;
  readonly outcome: ChannelQuantityPushOutcome;
  readonly pushedAt: Date;
}
