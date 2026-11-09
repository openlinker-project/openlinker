/**
 * Stock movement history - labels and tones (#3568)
 *
 * One table of presentation tokens, read by the product detail section and
 * the global page so the two cannot describe one row two ways. The words come
 * from the `inventory.stockMovement` namespace, read at call time so a
 * language switch is honoured. No I/O.
 *
 * `data-movement-type` tokens follow the M7 mockup verbatim (`sync`, `manual`,
 * `cancel_restore`, ...), because the E2E specs reach the live page through the
 * same `data-testid` / attribute values the mockup declares.
 *
 * @module apps/web/src/features/inventory/lib
 */
import { getMessages, interpolate } from '../../../shared/i18n';
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

function movementCopy(): ReturnType<typeof getMessages<'inventory'>>['stockMovement'] {
  return getMessages('inventory').stockMovement;
}

const REASON_PRESENTATION: Record<
  InventoryMovementReason,
  { token: MovementTypeToken; labelKey: keyof ReturnType<typeof movementCopy>['types']; chipClass: string }
> = {
  sale: { token: 'sale', labelKey: 'sale', chipClass: '' },
  cancellation_restore: { token: 'cancel_restore', labelKey: 'cancellationRestore', chipClass: 'chip--info' },
  return_restock: { token: 'return_restock', labelKey: 'returnRestock', chipClass: 'chip--success' },
  manual_correction: { token: 'manual', labelKey: 'manualCorrection', chipClass: 'chip--warning' },
  master_sync: { token: 'sync', labelKey: 'masterSync', chipClass: 'stock-movement-chip--muted' },
};

export function presentMovementType(row: InventoryMovementRow): MovementTypePresentation {
  const labels = movementCopy().types;
  if (row.kind === 'reservation' || row.reason === null) {
    return { token: 'reservation', label: labels.reservation, chipClass: 'chip--review' };
  }
  const entry = REASON_PRESENTATION[row.reason];
  return { token: entry.token, label: labels[entry.labelKey], chipClass: entry.chipClass };
}

export type MovementStatusTone = 'success' | 'error' | 'warning' | 'info' | 'neutral';

type StatusLabelKey = keyof ReturnType<typeof movementCopy>['statuses'];

const STATUS_PRESENTATION: Record<string, { labelKey: StatusLabelKey; tone: MovementStatusTone }> = {
  applied: { labelKey: 'applied', tone: 'success' },
  refused: { labelKey: 'refused', tone: 'error' },
  in_doubt: { labelKey: 'inDoubt', tone: 'warning' },
  pending: { labelKey: 'pending', tone: 'info' },
  held: { labelKey: 'held', tone: 'info' },
  released: { labelKey: 'released', tone: 'neutral' },
  consumed: { labelKey: 'consumed', tone: 'success' },
  expired: { labelKey: 'expired', tone: 'neutral' },
};

export function presentMovementStatus(status: string): { label: string; tone: MovementStatusTone } {
  const entry = Object.prototype.hasOwnProperty.call(STATUS_PRESENTATION, status)
    ? STATUS_PRESENTATION[status]
    : undefined;
  return entry ? { label: movementCopy().statuses[entry.labelKey], tone: entry.tone } : { label: status, tone: 'neutral' };
}

const SOURCE_KIND_KEY: Record<InventoryMovementSourceKind, keyof ReturnType<typeof movementCopy>['sourceKinds']> = {
  order: 'order',
  return: 'return',
  operator: 'operator',
  master_sync: 'masterSync',
};

export function sourceKindLabel(kind: InventoryMovementSourceKind | null): string | null {
  return kind === null ? null : movementCopy().sourceKinds[SOURCE_KIND_KEY[kind]];
}

const OPERATOR_REASON_KEY: Record<string, keyof ReturnType<typeof movementCopy>['operatorReasons']> = {
  count_correction: 'countCorrection',
  found: 'found',
  damaged: 'damaged',
  other: 'other',
};

/** The line under a manual correction: the operator's own classification plus the note. */
export function operatorReasonText(row: InventoryMovementRow): string | null {
  const copy = movementCopy();
  const key = row.operatorReason
    ? Object.prototype.hasOwnProperty.call(OPERATOR_REASON_KEY, row.operatorReason)
      ? OPERATOR_REASON_KEY[row.operatorReason]
      : undefined
    : undefined;
  const reason = row.operatorReason ? (key ? copy.operatorReasons[key] : row.operatorReason) : null;
  if (reason && row.note) return interpolate(copy.operatorReasonWithNote, { reason, note: row.note });
  return reason ?? (row.note || null);
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

const TYPE_FILTER_KEY: Record<MovementTypeFilterValue, keyof ReturnType<typeof movementCopy>['typeFilters']> = {
  sale: 'sale',
  cancellation_restore: 'cancellationRestore',
  return_restock: 'returnRestock',
  manual_correction: 'manualCorrection',
  master_sync: 'masterSync',
  reservation: 'reservation',
};

/** Read when rendered, so the active language is used. */
export function movementTypeFilterLabel(value: MovementTypeFilterValue): string {
  return movementCopy().typeFilters[TYPE_FILTER_KEY[value]];
}

export function isMovementTypeFilterValue(value: string | null): value is MovementTypeFilterValue {
  return value !== null && (MOVEMENT_TYPE_FILTER_VALUES as readonly string[]).includes(value);
}

const INTERNAL_ID_PAIR = /\b(?:productId|connectionId|variantId)=\S+/g;

/**
 * The sentence an operator reads for a refused write. Known reasons get plain
 * copy; an unknown reason keeps the adapter's words with internal ids removed,
 * because an id is not something an operator can act on.
 */
export function presentRefusalText(
  reason: string | null,
  detail: string | null,
  masterName: string | null,
): string | null {
  if (reason === 'master-product-not-found') {
    const copy = movementCopy();
    return interpolate(copy.masterProductNotFound, { master: masterName ?? copy.theShop });
  }
  if (detail === null) return null;
  const cleaned = detail
    .replace(INTERNAL_ID_PAIR, '')
    .replace(/\s+,/g, ',')
    .replace(/[,;:\s]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}
