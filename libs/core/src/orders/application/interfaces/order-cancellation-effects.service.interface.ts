/**
 * Order Cancellation Effects Service Interface (#3540, B-18)
 *
 * The cleanup a cancelled order owes, shared by the two paths that can complete a
 * cancel: the operator path (`OrderCancellationService` in `apps/api`, after the
 * source accepted) and the OBSERVED path (ingestion, when the source later
 * reports the order cancelled for a request whose HTTP answer never came back).
 * Both must leave the same state, so the effects live once, here.
 *
 * Every effect is idempotent, so the two paths racing each other is harmless.
 * Nothing here throws for a single effect failing: the order IS cancelled by the
 * time this runs, and a half-cleaned order reported honestly beats an exception
 * that strands it.
 *
 * Stock restore is deliberately NOT here: ingestion already enqueues it on the
 * `-> cancelled` transition under the shared `orderStockRestoreDedupeKey`.
 *
 * @module libs/core/src/orders/application/interfaces
 */
import type {
  OrderCancelCorrectionProposal,
  OrderCancelCorrectionUnavailableReason,
} from '../../domain/types/order-cancel.types';

export interface ApplyOrderCancellationEffectsInput {
  readonly internalOrderId: string;
  readonly cancelledAt: Date;
  /** The closed cancel reason code. */
  readonly reason: string;
  /** The operator who cancelled (or who asked for the cancel the source later confirmed). */
  readonly actorUserId: string | null;
}

export interface OrderCancellationEffectsResult {
  readonly cancelledWorkIds: readonly string[];
  readonly releasedHoldIds: readonly string[];
  readonly correctionProposal: OrderCancelCorrectionProposal | null;
  readonly correctionUnavailableReason: OrderCancelCorrectionUnavailableReason | null;
}

export interface IOrderCancellationEffectsService {
  applyEffects(input: ApplyOrderCancellationEffectsInput): Promise<OrderCancellationEffectsResult>;
}
