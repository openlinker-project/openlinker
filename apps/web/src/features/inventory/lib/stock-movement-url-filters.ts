/**
 * Stock movement history - URL filter state (#3568)
 *
 * The global page keeps every filter in the URL (state rules: filters are
 * linkable). This is the one place that turns search params into API filters,
 * so the page and its tests cannot disagree about what a param means.
 *
 * @module apps/web/src/features/inventory/lib
 */
import {
  InventoryMovementReasonValues,
  type InventoryMovementFilters,
  type InventoryMovementReason,
} from '../api/inventory-movements.types';
import { isMovementTypeFilterValue, type MovementTypeFilterValue } from './stock-movement-copy';

export type MovementChip = 'all' | 'attention' | 'promised';

export interface MovementUrlState {
  search: string;
  type: MovementTypeFilterValue | '';
  master: string;
  from: string;
  to: string;
  chip: MovementChip;
  productVariantId: string;
  /** Scopes the list to one product (the stock panel's multi-variant link). */
  productId: string;
  offset: number;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function readMovementUrlState(params: URLSearchParams): MovementUrlState {
  const type = params.get('type');
  const chip = params.get('chip');
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const offset = Number(params.get('offset') ?? '0');
  return {
    search: params.get('search') ?? '',
    type: isMovementTypeFilterValue(type) ? type : '',
    master: params.get('master') ?? '',
    from: DATE_PATTERN.test(from) ? from : '',
    to: DATE_PATTERN.test(to) ? to : '',
    chip: chip === 'attention' || chip === 'promised' ? chip : 'all',
    productVariantId: params.get('productVariantId') ?? '',
    productId: params.get('productId') ?? '',
    offset: Number.isInteger(offset) && offset > 0 ? offset : 0,
  };
}

function isReason(value: string): value is InventoryMovementReason {
  return (InventoryMovementReasonValues as readonly string[]).includes(value);
}

/**
 * True when a filter the operator set narrows the list (what "Clear filters"
 * would undo). The product / variant scope is NOT one: it comes from the link
 * they followed, so an empty scoped list says "none recorded yet", not "your
 * filters match nothing".
 */
export function hasActiveMovementFilters(state: MovementUrlState): boolean {
  return (
    state.search !== '' ||
    state.type !== '' ||
    state.master !== '' ||
    state.from !== '' ||
    state.to !== '' ||
    state.chip !== 'all'
  );
}

/** True when the list is scoped to one product or one variant by the URL. */
export function hasMovementScope(state: MovementUrlState): boolean {
  return state.productVariantId !== '' || state.productId !== '';
}

/**
 * A `YYYY-MM-DD` filter value is the operator's LOCAL calendar day, so its
 * boundaries are local midnight and the last local millisecond, converted to
 * ISO instants. A UTC day would drop 26 Sep 23:30 in Warsaw from "to 26 Sep".
 */
export function localDayStartIso(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}

export function localDayEndIso(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
}

export function toMovementFilters(state: MovementUrlState): InventoryMovementFilters {
  const promisedOnly = state.chip === 'promised' || state.type === 'reservation';
  const reason = state.type !== '' && isReason(state.type) ? state.type : undefined;
  return {
    productId: state.productId || undefined,
    productVariantId: state.productVariantId || undefined,
    reasons: reason ? [reason] : undefined,
    sourceConnectionId: state.master || undefined,
    from: state.from ? localDayStartIso(state.from) : undefined,
    to: state.to ? localDayEndIso(state.to) : undefined,
    needsAttention: state.chip === 'attention' ? true : undefined,
    kind: promisedOnly ? 'promised' : reason ? 'movements' : 'all',
    search: state.search || undefined,
  };
}
