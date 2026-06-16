/**
 * Simulates OpenLinker's `ShipmentStatusSyncService` poll.
 *
 * For each non-terminal shipment, OL calls `getTracking({ providerShipmentId })`,
 * maps the provider-native status to the canonical `ShipmentStatus`, backfills
 * `carrier` / `trackingNumber`, and (once dispatched) pushes the status to the
 * destination OMP. This shows the mapped snapshot for one shipment id.
 *
 *   INPOST_TOKEN=… node --experimental-strip-types examples/openlinker/03-status-sync.ts <providerShipmentId>
 */

import { buildAdapter, banner } from './_shared.ts';
import { TerminalShipmentStatusValues } from '../../openlinker/ol-shipping.types.ts';

async function main(): Promise<void> {
  const providerShipmentId = process.argv[2];
  if (!providerShipmentId) {
    console.error('usage: 03-status-sync.ts <providerShipmentId>');
    process.exit(1);
  }

  const adapter = buildAdapter();

  banner(`getTracking(${providerShipmentId})`);
  const snapshot = await adapter.getTracking({ providerShipmentId });
  console.log('TrackingSnapshot:', snapshot);

  const isTerminal = (TerminalShipmentStatusValues as readonly string[]).includes(snapshot.status);
  console.log(`\ncanonical status: ${snapshot.status} (${isTerminal ? 'terminal' : 'non-terminal — would re-poll'})`);
  console.log(`provider-native:  ${snapshot.providerStatus}`);
  console.log(`carrier-of-record: ${snapshot.carrier}`);
  if (snapshot.status === 'dispatched' || isTerminal) {
    console.log('→ OL would push this status to the destination OMP via OrderFulfillmentUpdater');
  }
}

main().catch((err) => {
  console.error('failed:', err);
  process.exit(1);
});
