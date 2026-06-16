/**
 * Demonstrates the SENDING-METHOD axis — how the parcel enters the InPost
 * network — which is orthogonal to the delivery method (paczkomat/kurier).
 *
 * Dispatches the same paczkomat order three ways and reads back the resulting
 * ShipX `sending_method` to prove they differ:
 *   courier_collect → dispatch_order   (InPost courier picks up from sender)
 *   drop_at_locker  → parcel_locker    (sender drops at a paczkomat)
 *   drop_at_point   → pop              (sender drops at a PUDO point)
 *
 * autoConfirm is OFF, so this only creates drafts (no buy = no balance spend),
 * reads the sending_method, then cancels each draft to clean up.
 *
 *   INPOST_TOKEN=… node --experimental-strip-types examples/openlinker/07-sending-methods.ts
 */

import { createInpostShipXClient, INPOST_SHIPX_SANDBOX_BASE_URL, InpostApiError } from '../../src/index.ts';
import {
  InpostShippingAdapter,
  type InpostSendingMethod,
} from '../../openlinker/inpost-shipping.adapter.ts';
import { CONNECTION_CONFIG, SAMPLE_RECIPIENT, requireToken, banner, fakeId } from './_shared.ts';
import type { GenerateLabelCommand } from '../../openlinker/ol-shipping.types.ts';

async function main(): Promise<void> {
  const client = createInpostShipXClient({
    token: requireToken(),
    baseUrl: process.env.INPOST_BASE ?? INPOST_SHIPX_SANDBOX_BASE_URL,
    organizationId: CONNECTION_CONFIG.organizationId,
    logLevel: 'warn',
  });
  const adapter = new InpostShippingAdapter(client, CONNECTION_CONFIG, { autoConfirm: false });

  // Destination locker + a DISTINCT sender locker (drop_at_locker requires both).
  const targets = await adapter.findPickupPoints({ city: 'Warszawa', limit: 1 });
  const targetLocker = process.env.INPOST_TARGET_POINT ?? targets[0]!.providerId;
  const dropoffLocker = process.env.INPOST_DROPOFF_POINT ?? '60000'; // sandbox parcel_send locker

  const scenarios: Array<{ method: InpostSendingMethod; dropoffPoint?: string }> = [
    { method: 'courier_collect' },
    { method: 'drop_at_locker', dropoffPoint: dropoffLocker },
    { method: 'drop_at_point' },
  ];

  banner(`sending methods — destination locker ${targetLocker}`);
  for (const scenario of scenarios) {
    const cmd: GenerateLabelCommand = {
      shipmentId: fakeId('shipment'),
      orderId: fakeId('order'),
      connectionId: 'conn_inpost_sandbox',
      shippingMethod: 'paczkomat',
      paczkomatId: targetLocker,
      recipient: SAMPLE_RECIPIENT,
      parcel: { template: 'small' },
    };

    const result = await adapter.generateLabel(cmd, {
      sendingMethod: scenario.method,
      dropoffPoint: scenario.dropoffPoint,
    });
    const shipment = await client.getShipment(result.providerShipmentId);
    const dropoff = (shipment.custom_attributes as { dropoff_point?: string }).dropoff_point;
    console.log(
      `  ${scenario.method.padEnd(16)} → ShipX sending_method=${String(shipment.sending_method)}` +
        (dropoff ? `, dropoff_point=${dropoff}` : ''),
    );

    // Best-effort cleanup: a funded account auto-selects the offer fast, and
    // cancel is only allowed at created/offers_prepared. Unbought drafts incur
    // no charge regardless, so a blocked cancel is harmless.
    try {
      await adapter.cancelShipment({ providerShipmentId: result.providerShipmentId });
    } catch (err) {
      if (!(err instanceof InpostApiError && err.code === 'invalid_action')) throw err;
      console.log(`      (draft ${result.providerShipmentId} past cancel window — left unbought, no charge)`);
    }
  }

  console.log('\n✓ all three sending methods created (drafts, unbought)');
}

main().catch((err) => {
  console.error('failed:', err);
  process.exit(1);
});
