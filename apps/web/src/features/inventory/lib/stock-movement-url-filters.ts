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
    offset: Number.isInteger(offset) && offset > 0 ? offset : 0,
  };
}

function isReason(value: string): value is InventoryMovementReason {
  return (InventoryMovementReasonValues as readonly string[]).includes(value);
}

/** True when anything narrows the list (what "Clear filters" would undo). */
export function hasActiveMovementFilters(state: MovementUrlState): boolean {
  return (
    state.search !== '' ||
    state.type !== '' ||
    state.master !== '' ||
    state.from !== '' ||
    state.to !== '' ||
    state.chip !== 'all' ||
    state.productVariantId !== ''
  );
}

export function toMovementFilters(state: MovementUrlState): InventoryMovementFilters {
  const promisedOnly = state.chip === 'promised' || state.type === 'reservation';
  const reason = state.type !== '' && isReason(state.type) ? state.type : undefined;
  return {
    productVariantId: state.productVariantId || undefined,
    reasons: reason ? [reason] : undefined,
    sourceConnectionId: state.master || undefined,
    from: state.from ? `${state.from}T00:00:00.000Z` : undefined,
    to: state.to ? `${state.to}T23:59:59.999Z` : undefined,
    needsAttention: state.chip === 'attention' ? true : undefined,
    kind: promisedOnly ? 'promised' : reason ? 'movements' : 'all',
    search: state.search || undefined,
  };
}
