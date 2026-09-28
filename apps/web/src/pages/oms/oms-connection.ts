/**
 * The OpenLinker OMS connection, found by platform (#3060, #3457)
 *
 * Every OMS page needs the `openlinker` connection, and the only way to find
 * it is its `platformType`. That comparison lives here, at the PAGE layer,
 * so no feature compares a platform name itself (D19) — the pages hand the
 * resolved connection down. Shared by the sourcing-rules page and the packing
 * onboarding page so the two cannot disagree about which connection it is.
 *
 * @module pages/oms
 */
import type { Connection } from '../../features/connections';

/** The discriminator `createOmsFulfillmentRouterResolver` uses (ADR-055). */
export const OMS_PLATFORM_TYPE = 'openlinker';

export function findOmsConnections(connections: readonly Connection[]): Connection[] {
  return connections.filter((connection) => connection.platformType === OMS_PLATFORM_TYPE);
}
