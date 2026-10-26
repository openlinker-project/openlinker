/**
 * Does this install have more than one active location? (#3096)
 *
 * One flag behind three things that only mean anything with two warehouses or
 * more: the board's "Group by Location" switch, a row's "· Main warehouse"
 * suffix, and the task detail's Location fact. On a one-warehouse install all
 * three name the same place on every task, which is noise that reads as a
 * choice the operator has not got.
 *
 * Read off `useActiveLocationCountQuery`, the install-wide `active`-only count
 * the sourcing-rules page already shares, so this costs no request of its own
 * once that cache entry exists.
 *
 * Unknown (loading) and unreadable both answer `false`: the three surfaces it
 * gates are supplementary, and hiding them on a failed count loses nothing an
 * operator needs — whereas showing a grouping switch that groups everything
 * into one lane looks broken.
 *
 * @module apps/web/src/features/fulfillment/hooks
 */
import { useActiveLocationCountQuery } from '../../inventory';

export function useHasMultipleLocations(): boolean {
  const query = useActiveLocationCountQuery();
  return (query.data ?? 0) > 1;
}
