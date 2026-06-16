/**
 * Simulates OpenLinker's `ShipmentCanceller` (AC-7 cancel + re-issue).
 *
 * Demonstrates the ShipX rule the real adapter documents: cancellation is only
 * allowed PRE-confirmation. We create a draft (autoConfirm OFF so it stays at
 * `created`/`offers_prepared`), cancel it successfully, then show that a
 * confirmed shipment refuses cancellation with `invalid_action`.
 *
 *   INPOST_TOKEN=… node --experimental-strip-types examples/openlinker/04-cancel.ts
 */

import { buildAdapter, banner, fakeId, SAMPLE_RECIPIENT } from './_shared.ts';
import { InpostApiError } from '../../src/index.ts';
import type { GenerateLabelCommand } from '../../openlinker/ol-shipping.types.ts';

function buildCmd(locker: string): GenerateLabelCommand {
  return {
    shipmentId: fakeId('shipment'),
    orderId: fakeId('order'),
    connectionId: 'conn_inpost_sandbox',
    shippingMethod: 'paczkomat',
    paczkomatId: locker,
    recipient: SAMPLE_RECIPIENT,
    parcel: { template: 'small' },
  };
}

async function main(): Promise<void> {
  // autoConfirm OFF → generateLabel returns at the pre-confirmation state.
  const draftAdapter = buildAdapter({ autoConfirm: false });
  const points = await draftAdapter.findPickupPoints({ city: 'Warszawa', limit: 1 });
  const locker = process.env.INPOST_TARGET_POINT ?? points[0]!.providerId;

  banner('case 1 — cancel a pre-confirmation shipment (should succeed)');
  const draft = await draftAdapter.generateLabel(buildCmd(locker));
  console.log('created draft:', draft.providerShipmentId);
  await draftAdapter.cancelShipment({ providerShipmentId: draft.providerShipmentId });
  console.log('✓ cancelled');
  const after = await draftAdapter.getTracking({ providerShipmentId: draft.providerShipmentId });
  console.log('status after cancel:', after.status, `(provider: ${after.providerStatus})`);

  banner('case 2 — cancel a confirmed shipment (should be rejected)');
  const confirmAdapter = buildAdapter({ autoConfirm: true });
  const confirmed = await confirmAdapter.generateLabel(buildCmd(locker));
  console.log('confirmed shipment:', confirmed.providerShipmentId, 'tracking:', confirmed.trackingNumber);
  try {
    await confirmAdapter.cancelShipment({ providerShipmentId: confirmed.providerShipmentId });
    console.log('⚠ unexpectedly cancelled a confirmed shipment');
  } catch (err) {
    if (err instanceof InpostApiError) {
      console.log(`✓ rejected as expected: ${err.status} [${err.code ?? '—'}] ${err.message}`);
    } else {
      throw err;
    }
  }
}

main().catch((err) => {
  console.error('failed:', err);
  process.exit(1);
});
