/**
 * Stock row model (#3569, mockup m25)
 *
 * What the product page's variants table needs to know about each variant's
 * stock, decided once: the state the row is in, the master's own figures, the
 * name of the connection that owns the stock and whether an operator may adjust
 * it. The page builds the map; the table, the cell and the expanded row only
 * read it.
 *
 * Three rules run through every consumer. A `null` available to sell is "not
 * known" and is never drawn as 0. A variant the master has stopped reporting is
 * labelled, not quietly zeroed. And a name is only ever one OpenLinker was
 * given - never a platform guessed from a type.
 *
 * @module apps/web/src/features/inventory/lib
 */
import { deriveStockStatus } from '../../products';
import type { InventoryItem, StockChannelsStatus, StockViewVariant } from '../api/inventory.types';
import { isAtpUnknown, isMultiLocation, isVariantStaled } from './stock-view';

export interface StockPanelVariant {
  id: string;
  sku: string | null;
  attributes: Record<string, string> | null;
}

/** What the correction dialog needs to open for one variant. */
export interface StockAdjustTarget {
  variant: StockPanelVariant;
  /** `null` while the stock view is loading or failed - the dialog must not guess. */
  stock: StockViewVariant | null;
}

export type StockRowState = 'loading' | 'restricted' | 'unknown' | 'staled' | 'ok';

/** Stands in for a connection name nobody supplied; callers show a dash rather than this. */
export const UNNAMED_MASTER = 'the master';

export const VIEWER_STOCK_HINT = 'Only admins and operators can change stock.';

export interface StockRowModel {
  variant: StockPanelVariant;
  /** `sku ?? id` - the suffix every stock test id carries. */
  key: string;
  state: StockRowState;
  stock: StockViewVariant | null;
  /** The master's own count: from the stock view, else the page's inventory read. */
  masterAvailable: number;
  /** What the master itself has reserved, already taken out of `masterAvailable`. */
  masterReserved: number;
  /** Connections whose live positions make up the count; empty when none was named. */
  sourceNames: string[];
  /** Display name for the stock source, e.g. "PrestaShop" or "PrestaShop + WooCommerce". */
  masterName: string;
  multiLocation: boolean;
  /** Live positions come from two or more distinct connections. */
  multiSource: boolean;
  /** Why Adjust is off, or `null` when the operator may use it. */
  adjustHint: string | null;
}

export interface ProductStockModel {
  rows: ReadonlyMap<string, StockRowModel>;
  channelsStatus: StockChannelsStatus;
  canAdjust: boolean;
  onAdjust?: (target: StockAdjustTarget) => void;
  /** Points the stock history section at a variant and brings it into view. */
  onShowHistory?: (variantId: string) => void;
}

export function stockRowKey(variant: StockPanelVariant): string {
  return variant.sku ?? variant.id;
}

function liveSources(stock: StockViewVariant | null): { ids: string[]; names: string[] } {
  const ids = new Set<string>();
  const names = new Set<string>();
  const staleNames = new Set<string>();
  for (const position of stock?.positions ?? []) {
    if (position.isStale) {
      if (position.sourceConnectionName) staleNames.add(position.sourceConnectionName);
      continue;
    }
    ids.add(position.sourceConnectionId ?? position.sourceConnectionName ?? 'unattributed');
    if (position.sourceConnectionName) names.add(position.sourceConnectionName);
  }
  // A variant the master stopped reporting has no live position, but "Missing in
  // PrestaShop" still has to name the shop that stopped reporting it.
  return { ids: [...ids], names: names.size > 0 ? [...names] : [...staleNames] };
}

export interface BuildStockRowsInput {
  variants: readonly StockPanelVariant[];
  inventoryItems: readonly InventoryItem[];
  stockByVariant: ReadonlyMap<string, StockViewVariant> | null;
  pending: boolean;
  restricted: boolean;
  canAdjust: boolean;
  /** Name of the product's source connection, used when positions name none. */
  fallbackMasterName: string | null;
}

export function buildStockRows(input: BuildStockRowsInput): Map<string, StockRowModel> {
  const rows = new Map<string, StockRowModel>();
  for (const variant of input.variants) {
    const stock = input.stockByVariant?.get(variant.id) ?? null;
    const items = input.inventoryItems.filter((item) => item.productVariantId === variant.id);
    const masterAvailable =
      stock?.masterAvailable ?? items.reduce((sum, item) => sum + item.availableQuantity, 0);
    const masterReserved = stock?.masterReserved ?? items.reduce((sum, item) => sum + item.reservedQuantity, 0);
    let state: StockRowState;
    if (input.restricted) state = 'restricted';
    else if (input.pending) state = 'loading';
    else if (!stock || isAtpUnknown(stock)) state = 'unknown';
    else if (isVariantStaled(stock)) state = 'staled';
    else state = 'ok';

    const sources = liveSources(stock);
    const sourceNames = sources.names.length > 0 ? sources.names : [];
    const masterName =
      sourceNames.length > 0 ? sourceNames.join(' + ') : (input.fallbackMasterName ?? UNNAMED_MASTER);
    const multiLocation = stock !== null && isMultiLocation(stock);
    const multiSource = sources.ids.length > 1;

    let adjustHint: string | null = null;
    if (!input.canAdjust) adjustHint = VIEWER_STOCK_HINT;
    else if (state === 'unknown') adjustHint = 'Available again once OpenLinker can read the count.';
    else if (multiSource) adjustHint = 'Two shops count this variant. Correct it in the shop that should own it.';
    else if (multiLocation && stock) {
      adjustHint = `This variant is in ${stock.livePositionCount} locations. Correct it in ${masterName}.`;
    } else if (state === 'staled') adjustHint = `${masterName} no longer reports this variant.`;

    rows.set(variant.id, {
      variant,
      key: stockRowKey(variant),
      state,
      stock,
      masterAvailable,
      masterReserved,
      sourceNames,
      masterName,
      multiLocation,
      multiSource,
      adjustHint,
    });
  }
  return rows;
}

/** The badge one variant's headline number earns. */
export type StockRowStatus =
  | { kind: 'in-stock' | 'low-stock' | 'out-of-stock' }
  | { kind: 'short'; by: number }
  | { kind: 'not-known' }
  | { kind: 'missing' };

/**
 * `short` wins over the quantity bands: more units reserved than the master
 * holds is a fact about the master, and "Out of stock" would hide that someone
 * is owed goods that are not there.
 */
export function deriveRowStatus(row: StockRowModel): StockRowStatus {
  if (row.state === 'unknown' || row.state === 'loading' || row.state === 'restricted') {
    return { kind: 'not-known' };
  }
  if (row.state === 'staled') return { kind: 'missing' };
  const stock = row.stock;
  const toSell = stock?.availableToPromise ?? null;
  if (stock === null || toSell === null) return { kind: 'not-known' };
  const reserved = stock.heldCounted ?? 0;
  if (reserved > row.masterAvailable) return { kind: 'short', by: reserved - row.masterAvailable };
  const status = deriveStockStatus(toSell);
  return { kind: status === 'oversold' ? 'out-of-stock' : status };
}
