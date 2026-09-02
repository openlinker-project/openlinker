/**
 * Top products view-model helpers
 *
 * Pure functions the table component calls — no JSX, no React (#1991).
 *
 * @module features/analytics/lib
 */
import type {
  ProductChannelSales,
  TopProductRow,
  TopProductVariantRow,
  VariantChannelSales,
} from '../api/top-products.types';

/**
 * Union of channel connection ids across every row, in first-seen order.
 * First-seen (not sorted) so the column order doesn't reshuffle itself when
 * the sort toggle changes row order.
 *
 * Includes `missingFromConnectionIds` as well as `channels[]`: a
 * listing-capable connection nobody on this page has sold on yet would
 * otherwise never get a column, making a "sells elsewhere, not listed here"
 * flag for it unrenderable — exactly the gap the flag exists to surface.
 */
export function deriveChannelColumns(rows: TopProductRow[]): string[] {
  const seen = new Set<string>();
  const columns: string[] = [];
  const add = (connectionId: string): void => {
    if (!seen.has(connectionId)) {
      seen.add(connectionId);
      columns.push(connectionId);
    }
  };
  for (const row of rows) {
    for (const channel of row.channels) {
      add(channel.sourceConnectionId);
    }
    for (const connectionId of row.missingFromConnectionIds) {
      add(connectionId);
    }
  }
  return columns;
}

export function channelCellFor(row: TopProductRow, connectionId: string): ProductChannelSales | undefined {
  return row.channels.find((channel) => channel.sourceConnectionId === connectionId);
}

export function isMissingFrom(row: TopProductRow, connectionId: string): boolean {
  return row.missingFromConnectionIds.includes(connectionId);
}

/** Variant-scoped counterpart of {@link channelCellFor} (#2765). */
export function variantChannelCellFor(
  variant: TopProductVariantRow,
  connectionId: string
): VariantChannelSales | undefined {
  return variant.channels.find((channel) => channel.sourceConnectionId === connectionId);
}
