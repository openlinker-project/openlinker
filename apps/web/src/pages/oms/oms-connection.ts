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
import { readSourcingClaim } from '../../features/oms-onboarding';
import type { StatusBadgeTone } from '../../shared/ui/status-badge';

/** The discriminator `createOmsFulfillmentRouterResolver` uses (ADR-055). */
export const OMS_PLATFORM_TYPE = 'openlinker';

export function findOmsConnections(connections: readonly Connection[]): Connection[] {
  return connections.filter((connection) => connection.platformType === OMS_PLATFORM_TYPE);
}

export interface ConnectionStatusView {
  readonly label: string;
  readonly tone: StatusBadgeTone;
}

/**
 * What the status badge says for a connection (#3457).
 *
 * The OMS holds no external account, so `active` / `disabled` says nothing
 * true about it: what decides whether orders are packed is the sourcing claim
 * its Stop / Start writes. An OMS connection that is `active` therefore reads
 * On / Off from that claim; any other status (`disabled`, `error`) still
 * shows as itself, and every other platform keeps its plain status.
 */
export function describeConnectionStatus(
  connection: Connection,
  fallbackTone: StatusBadgeTone
): ConnectionStatusView {
  if (connection.platformType !== OMS_PLATFORM_TYPE || connection.status !== 'active') {
    return { label: connection.status, tone: fallbackTone };
  }
  return readSourcingClaim(connection.config) === 'on'
    ? { label: 'On', tone: 'success' }
    : { label: 'Off', tone: 'neutral' };
}
