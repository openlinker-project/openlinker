/**
 * Stock movement history - labels and tones (#3568)
 *
 * One table of operator copy and presentation tokens, read by the product
 * detail section and the global page so the two cannot describe one row two
 * ways. Pure: no I/O, nothing from a component.
 *
 * `data-movement-type` tokens follow the M7 mockup verbatim (`sync`, `manual`,
 * `cancel_restore`, ...), because the E2E specs reach the live page through the
 * same `data-testid` / attribute values the mockup declares.
 *
 * @module apps/web/src/features/inventory/lib
 */
import type {
  InventoryMovementReason,
  InventoryMovementRow,
  InventoryMovementSourceKind,
} from '../api/inventory-movements.types';

export type MovementTypeToken =
  | 'sale'
  | 'cancel_restore'
  | 'return_restock'
  | 'manual'
  | 'sync'
  | 'reservation';

export interface MovementTypePresentation {
  token: MovementTypeToken;
  label: string;
  /** Extra class on the type chip (`chip--*`). */
  chipClass: string;
}

const REASON_PRESENTATION: Record<InventoryMovementReason, MovementTypePresentation> = {
  sale: { token: 'sale', label: 'Sale', chipClass: '' },
  cancellation_restore: {
    token: 'cancel_restore',
    label: 'Cancellation restore',
    chipClass: 'chip--info',
  },
  return_restock: { token: 'return_restock', label: 'Return restock', chipClass: 'chip--success' },
  manual_correction: { token: 'manual', label: 'Manual correction', chipClass: 'chip--warning' },
  master_sync: { token: 'sync', label: 'Sync change detected', chipClass: 'stock-movement-chip--muted' },
};

const RESERVATION_PRESENTATION: MovementTypePresentation = {
  token: 'reservation',
  label: 'Reservation',
  chipClass: 'chip--review',
};

export function presentMovementType(row: InventoryMovementRow): MovementTypePresentation {
  if (row.kind === 'reservation' || row.reason === null) return RESERVATION_PRESENTATION;
  return REASON_PRESENTATION[row.reason];
}

export type MovementStatusTone = 'success' | 'error' | 'warning' | 'info' | 'neutral';

const STATUS_PRESENTATION: Record<string, { label: string; tone: MovementStatusTone }> = {
  applied: { label: 'Applied', tone: 'success' },
  refused: { label: 'Refused', tone: 'error' },
  in_doubt: { label: 'In doubt', tone: 'warning' },
  pending: { label: 'Pending', tone: 'info' },
  held: { label: 'Held', tone: 'info' },
  released: { label: 'Released', tone: 'neutral' },
  consumed: { label: 'Consumed', tone: 'success' },
  expired: { label: 'Expired', tone: 'neutral' },
};

export function presentMovementStatus(status: string): { label: string; tone: MovementStatusTone } {
  return STATUS_PRESENTATION[status] ?? { label: status, tone: 'neutral' };
}

const SOURCE_KIND_LABEL: Record<InventoryMovementSourceKind, string> = {
  order: 'Order',
  return: 'Return',
  operator: 'Operator',
  master_sync: 'Master sync',
};

export function sourceKindLabel(kind: InventoryMovementSourceKind | null): string | null {
  return kind === null ? null : SOURCE_KIND_LABEL[kind];
}

const OPERATOR_REASON_LABEL: Record<string, string> = {
  count_correction: 'Count correction',
  found: 'Found',
  damaged: 'Damaged',
  other: 'Other',
};

/** The line under a manual correction: the operator's own classification plus the note. */
export function operatorReasonText(row: InventoryMovementRow): string | null {
  const parts: string[] = [];
  if (row.operatorReason) parts.push(OPERATOR_REASON_LABEL[row.operatorReason] ?? row.operatorReason);
  if (row.note) parts.push(row.note);
  return parts.length > 0 ? parts.join(' - ') : null;
}

/** A refused or unconfirmed movement is one the operator should look at. */
export function movementNeedsAttention(row: InventoryMovementRow): boolean {
  return row.kind === 'movement' && (row.status === 'refused' || row.status === 'in_doubt');
}

/** Type filter options on the global page; `reservation` maps to the promised kind. */
export const MOVEMENT_TYPE_FILTER_VALUES = [
  'sale',
  'cancellation_restore',
  'return_restock',
  'manual_correction',
  'master_sync',
  'reservation',
] as const;
export type MovementTypeFilterValue = (typeof MOVEMENT_TYPE_FILTER_VALUES)[number];

export const MOVEMENT_TYPE_FILTER_LABEL: Record<MovementTypeFilterValue, string> = {
  sale: 'Sale (OpenLinker order)',
  cancellation_restore: 'Cancellation restore',
  return_restock: 'Return restock',
  manual_correction: 'Manual correction',
  master_sync: 'Sync change detected',
  reservation: 'Reservation',
};

export function isMovementTypeFilterValue(value: string | null): value is MovementTypeFilterValue {
  return value !== null && (MOVEMENT_TYPE_FILTER_VALUES as readonly string[]).includes(value);
}
