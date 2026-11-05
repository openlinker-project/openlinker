/**
 * Shipping coverage (#3958)
 *
 * The pure half of the OMS setup's Shipping step: which connections take
 * orders, which can buy labels, and how many of an order source's delivery
 * methods have a saved route that makes OpenLinker buy one. "Done" is derived
 * from saved rules, the way `use-setup-steps` derives every other step, so the
 * step, its stepper tick and the status page cannot disagree.
 *
 * @module features/oms-onboarding/lib
 */
import type { Connection } from '../../connections';
import { routeBuysLabel, type RoutingRule } from '../../mappings';

export const ORDER_SOURCE_CAPABILITY = 'OrderSource';
export const CARRIER_CAPABILITY = 'ShippingProviderManager';

/**
 * - `loading`     - the delivery methods or the saved rules are still arriving.
 * - `ready`       - both are known; the counts are true.
 * - `cannot-list` - the source does not report its delivery methods (PrestaShop
 *                   and WooCommerce answer 501), so it cannot be routed at all.
 * - `load-failed` - the delivery methods could not be read this time (any error
 *                   other than 501). Never shown as "does not report", which
 *                   would state a permanent fact the failure does not prove.
 * - `unknown`     - the saved rules could not be read; the counts mean nothing.
 */
export type SourceCoverageStatus = 'loading' | 'ready' | 'cannot-list' | 'load-failed' | 'unknown';

export interface SourceShippingCoverage {
  readonly status: SourceCoverageStatus;
  /** Delivery methods with a saved route that buys a label. */
  readonly withCarrier: number;
  /** Delivery methods the source reports. */
  readonly total: number;
}

export type ShippingCoverageMap = Readonly<Record<string, SourceShippingCoverage>>;

/**
 * Connections whose orders can be routed: active, taking orders, and not the
 * packing connection itself (which holds no orders of its own). Matched by
 * capability and by id, never by platform.
 */
export function selectOrderSources(
  connections: readonly Connection[],
  packingConnectionId: string | null
): Connection[] {
  return connections.filter(
    (connection) =>
      connection.id !== packingConnectionId &&
      connection.status === 'active' &&
      connection.enabledCapabilities.includes(ORDER_SOURCE_CAPABILITY) &&
      connection.supportedCapabilities.includes(ORDER_SOURCE_CAPABILITY)
  );
}

/** Active connections OpenLinker can buy a label from (InPost, DPD). */
export function selectCarriers(connections: readonly Connection[]): Connection[] {
  return connections.filter(
    (connection) => connection.status === 'active' && connection.enabledCapabilities.includes(CARRIER_CAPABILITY)
  );
}

/**
 * How many of `methodIds` have a saved route that buys a label. A route to a
 * carrier counts only while that carrier connection is active: a label cannot
 * be bought from a switched-off one, so counting it would promise a label the
 * worker will not get. A rule for a method the source no longer reports is
 * left out, so the count never exceeds the total.
 */
export function countRoutedMethods(
  methodIds: ReadonlySet<string>,
  rules: readonly RoutingRule[],
  activeConnectionIds: ReadonlySet<string>
): number {
  return rules.filter(
    (rule) =>
      methodIds.has(rule.sourceDeliveryMethodId) &&
      routeBuysLabel(rule.processorKind) &&
      (rule.processorKind !== 'ol_managed_carrier' || activeConnectionIds.has(rule.processorConnectionId))
  ).length;
}

export type CoverageBadge = 'todo' | 'partly' | 'all';

export function coverageBadge(coverage: SourceShippingCoverage): CoverageBadge {
  if (coverage.withCarrier === 0) return 'todo';
  return coverage.total > 0 && coverage.withCarrier >= coverage.total ? 'all' : 'partly';
}

export interface ShippingCoverageTotals {
  readonly withCarrier: number;
  readonly total: number;
  /** Every listed source has answered; a source that cannot list counts as answered. */
  readonly settled: boolean;
  /** At least one source's rules could not be read. */
  readonly unknown: boolean;
}

/** Totals over the sources that can be routed, for the step's part 2 and the status row. */
export function summariseShippingCoverage(
  sourceIds: readonly string[],
  coverage: ShippingCoverageMap
): ShippingCoverageTotals {
  let withCarrier = 0;
  let total = 0;
  let settled = true;
  let unknown = false;
  for (const id of sourceIds) {
    const entry = coverage[id];
    if (entry === undefined || entry.status === 'loading') {
      settled = false;
      continue;
    }
    if (entry.status === 'unknown' || entry.status === 'load-failed') unknown = true;
    if (entry.status !== 'ready') continue;
    withCarrier += entry.withCarrier;
    total += entry.total;
  }
  return { withCarrier, total, settled, unknown };
}
