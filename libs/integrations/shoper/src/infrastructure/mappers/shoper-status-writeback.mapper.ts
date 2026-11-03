/**
 * Shoper Status Writeback Mapper
 *
 * Pure decisions for the `cancelled` / `in-progress` writeback: which shop status
 * an event moves the order to when the operator configured none, and whether the
 * order's current status already says what the event says. No I/O.
 *
 * Only the status `type` is read, never a label the merchant typed: type 4 is
 * "not completed" in every shop, type 2 "in progress". Type 4 also covers refunds
 * and returns, so a cancellation picks a type-4 status whose labels do NOT read
 * as a refund (the same label rule the order source uses).
 *
 * @module libs/integrations/shoper/src/infrastructure/mappers
 */
import type {
  ShoperOrderStatusEntry,
  ShoperOrderStatusInfo,
  ShoperStatusWritebackPlan,
  ShoperStatusWritebackTarget,
} from '../../domain/types/shoper-order-status.types';
import { SHOPER_STATUS_TYPE } from '../../domain/types/shoper-order-status.types';
import { mapShoperOrderStatus } from './shoper-incoming-order.mapper';

/**
 * The first active status the event can move an order to, by ascending id, or
 * null when the shop lists none. `statuses` is expected in id order.
 */
export function pickShoperWritebackStatus(
  statuses: readonly ShoperOrderStatusEntry[],
  target: ShoperStatusWritebackTarget,
): string | null {
  const match = statuses.find((status) => status.active !== false && isTargetStatus(status, target));
  return match?.statusId ?? null;
}

/**
 * - `cancelled` on an order already in a type-4 status is in effect (and a refund
 *   or return status must not be overwritten by a plain cancel); on a completed
 *   order (type 3) it is refused, as every other participant refuses a cancel
 *   after shipping.
 * - `in-progress` on an order already in progress is in effect; on a completed or
 *   closed one it is refused rather than moving the order backwards.
 * - An unknown current status (the shop does not list it) is written over.
 */
export function planShoperStatusWriteback(
  current: ShoperOrderStatusInfo | null,
  target: ShoperStatusWritebackTarget,
): ShoperStatusWritebackPlan {
  if (current === null) {
    return { kind: 'write' };
  }
  if (target === 'cancelled') {
    if (current.type === SHOPER_STATUS_TYPE.NotCompleted) {
      return { kind: 'already-applied' };
    }
    if (current.type === SHOPER_STATUS_TYPE.Completed) {
      return { kind: 'refused', reason: 'the order is already completed in the shop' };
    }
    return { kind: 'write' };
  }
  if (current.type === SHOPER_STATUS_TYPE.InProgress) {
    return { kind: 'already-applied' };
  }
  if (current.type === SHOPER_STATUS_TYPE.Completed || current.type === SHOPER_STATUS_TYPE.NotCompleted) {
    return {
      kind: 'refused',
      reason: 'the order is already completed or closed in the shop and is not moved back to in progress',
    };
  }
  return { kind: 'write' };
}

function isTargetStatus(status: ShoperOrderStatusInfo, target: ShoperStatusWritebackTarget): boolean {
  if (target === 'in-progress') {
    return status.type === SHOPER_STATUS_TYPE.InProgress;
  }
  return status.type === SHOPER_STATUS_TYPE.NotCompleted && mapShoperOrderStatus(status) === 'cancelled';
}
