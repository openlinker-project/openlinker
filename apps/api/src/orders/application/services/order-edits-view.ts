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
  effectiveDiscountAmount,
  effectiveLineQuantity,
  findUnmatchedLineEdits,
  type Address,
  type OrderChange,
  type OrderEdits,
  type OrderOperatorEditKind,
} from '@openlinker/core/orders';

import type {
  OrderDiscountProposalEntry,
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
    edits.discount?.editedAt,
    ...Object.values(edits.lines ?? {}).map((line) => line.editedAt),
  ].filter((value): value is string => value !== undefined);
  return stamps.sort().at(-1) ?? new Date(0).toISOString();
}

export function buildOrderEditHistory(
  changes: readonly OrderChange[],
  channelConnectionId: string
): OrderEditHistoryEntry[] {
  // B-27: only CONFIRMED edits are history. An edit abandoned before its overlay
  // write landed (`expired`) never changed the order, and rendering it as
  // "changed" would tell the operator something false.
  return changes
    .filter((change) => change.status === 'confirmed')
    .map((change) => ({
    changeId: change.id,
    kind: change.kind as OrderOperatorEditKind,
    at: change.requestedAt.toISOString(),
    byUserId: change.requestedBy,
    channelKeeps: true,
    channelConnectionId,
  }));
}

/** The open discount proposals among `changes`, in the shape a surface renders. */
export function buildDiscountProposals(changes: readonly OrderChange[]): OrderDiscountProposalEntry[] {
  const out: OrderDiscountProposalEntry[] = [];
  for (const change of changes) {
    if (change.kind !== 'order.discount_refund' && change.kind !== 'order.discount_correction') continue;
    if (!change.isOpen()) continue;
    const payload = change.payload ?? {};
    out.push({
      changeId: change.id,
      kind: change.kind,
      status: change.status,
      requestedAt: change.requestedAt.toISOString(),
      currency: readString(payload.currency) ?? '',
      amount: change.kind === 'order.discount_refund' ? readString(payload.amount) : null,
      invoiceRecordId:
        change.kind === 'order.discount_correction' ? readString(payload.invoiceRecordId) : null,
    });
  }
  return out;
}

export function buildOrderEditsView(
  channelSnapshot: Record<string, unknown>,
  edits: OrderEdits,
  history: readonly OrderEditHistoryEntry[],
  discountProposals: readonly OrderDiscountProposalEntry[] = []
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
    unmatchedLineEdits: findUnmatchedLineEdits(channelSnapshot, edits),
    totals: describeEditedTotals(channelSnapshot, edits),
    discount:
      edits.discount !== undefined && effectiveDiscountAmount(edits.discount) > 0 ? edits.discount : null,
    discountProposals,
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
