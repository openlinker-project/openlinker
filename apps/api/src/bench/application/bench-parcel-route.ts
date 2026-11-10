/**
 * The bench's reading of a routing decision (#3958)
 *
 * One function from `FulfillmentRoutingResolution` to `BenchParcelRouteView`,
 * kept apart from the resolver that does the I/O so the mapping can be tested
 * without standing up the routing service or the connection read.
 *
 * Pure: no I/O, no clock, no injected dependency.
 *
 * @module apps/api/src/bench/application
 */
import type { FulfillmentRoutingResolution } from '@openlinker/core/mappings';

import type { BenchParcelRouteView } from './types/bench-parcel.types';

export interface BenchParcelRouteInput {
  readonly resolution: FulfillmentRoutingResolution;
  /** The routed connection's name, already looked up; `null` when there is none. */
  readonly processorName: string | null;
  /** The order's own delivery-method label (`OrderRecord.sourceDeliveryMethodName`). */
  readonly methodLabel: string | null;
}

export function toBenchParcelRoute(input: BenchParcelRouteInput): BenchParcelRouteView {
  const { resolution } = input;
  return {
    processorKind: resolution.processorKind,
    // The default route names no connection, so a name carried over from a
    // lookup there would describe nothing the route actually does.
    processorName: resolution.processorConnectionId === null ? null : input.processorName,
    // Keyed on the resolution's own `source`, never on `processorKind`: a rule
    // may legitimately route to `omp_fulfilled`, and that is an operator's
    // choice the bench must not read as "nobody chose".
    fromRule: resolution.source === 'rule',
    processorAvailable: resolution.processorAvailable,
    methodLabel: blankToNull(input.methodLabel),
  };
}

function blankToNull(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
