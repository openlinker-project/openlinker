/**
 * Order Edits View (#3542)
 *
 * Pure projection of an order's overlay beside the channel's own snapshot: the
 * two figures every surface shows ("paid on the channel" and "after the edit").
 * No I/O, so the dry run (`edit-review`) and the saved state (`edit-saved`) are
 * built by the same function and cannot disagree.
 *
 * @module apps/api/src/orders/application/services
 */
import {
  applyOrderEditsToSnapshot,
  describeEditedTotals,
  effectiveLineQuantity,
  type Address,
  type OrderChange,
  type OrderEdits,
  type OrderOperatorEditKind,
} from '@openlinker/core/orders';

import type {
  OrderEditHistoryEntry,
  OrderEditsLineView,
  OrderEditsView,
} from '../types/order-edit.types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** The latest instant any section of the overlay was written. */
function latestEditedAt(edits: OrderEdits): string {
  const stamps = [
    edits.address?.editedAt,
    edits.deliveryMethod?.editedAt,
    ...Object.values(edits.lines ?? {}).map((line) => line.editedAt),
  ].filter((value): value is string => value !== undefined);
  return stamps.sort().at(-1) ?? new Date(0).toISOString();
}

export function buildOrderEditHistory(
  changes: readonly OrderChange[],
  channelConnectionId: string
): OrderEditHistoryEntry[] {
  return changes.map((change) => ({
    changeId: change.id,
    kind: change.kind as OrderOperatorEditKind,
    at: change.requestedAt.toISOString(),
    byUserId: change.requestedBy,
    channelKeeps: true,
    channelConnectionId,
  }));
}

export function buildOrderEditsView(
  channelSnapshot: Record<string, unknown>,
  edits: OrderEdits,
  history: readonly OrderEditHistoryEntry[]
): OrderEditsView {
  const effective = applyOrderEditsToSnapshot(channelSnapshot, edits);

  const lines: OrderEditsLineView[] = [];
  const channelItems = Array.isArray(channelSnapshot.items) ? channelSnapshot.items : [];
  for (const raw of channelItems) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.quantity !== 'number') continue;
    const quantity = effectiveLineQuantity(raw.quantity, edits.lines?.[raw.id]);
    if (quantity < raw.quantity) {
      lines.push({ orderLineId: raw.id, channelQuantity: raw.quantity, quantity });
    }
  }

  const channelShipping = isRecord(channelSnapshot.shipping) ? channelSnapshot.shipping : null;
  const channelCod = isRecord(channelSnapshot.codToCollect) ? channelSnapshot.codToCollect : null;
  const effectiveCod = isRecord(effective.codToCollect) ? effective.codToCollect : null;

  return {
    editedAt: latestEditedAt(edits),
    address:
      edits.address === undefined
        ? null
        : {
            original: isRecord(channelSnapshot.shippingAddress)
              ? (channelSnapshot.shippingAddress as unknown as Address)
              : null,
            current: edits.address.shipping,
          },
    lines,
    deliveryMethod:
      edits.deliveryMethod === undefined
        ? null
        : {
            original: {
              id: readString(channelShipping?.methodId),
              name: readString(channelShipping?.methodName),
            },
            current: { id: edits.deliveryMethod.methodId, name: edits.deliveryMethod.methodName },
          },
    totals: describeEditedTotals(channelSnapshot, edits),
    cod:
      channelCod !== null &&
      typeof channelCod.amount === 'string' &&
      typeof channelCod.currency === 'string'
        ? {
            channelAmount: channelCod.amount,
            amount: effectiveCod !== null && typeof effectiveCod.amount === 'string' ? effectiveCod.amount : null,
            currency: channelCod.currency,
          }
        : null,
    history,
  };
}
