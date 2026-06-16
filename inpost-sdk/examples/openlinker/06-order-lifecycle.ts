/**
 * End-to-end OpenLinker narrative: a marketplace order → shipment → label →
 * status sync. Stitches the slices (ingestion-derived intent, dispatch,
 * status-sync) into the story the real OL services play out across jobs.
 *
 *   INPOST_TOKEN=… node --experimental-strip-types examples/openlinker/06-order-lifecycle.ts
 *
 * Set ORDER_MODE=address to run the courier variant (default: paczkomat).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildAdapter,
  banner,
  fakeId,
  SAMPLE_RECIPIENT,
  SAMPLE_COURIER_ADDRESS,
  isCourierNotProvisioned,
  explainCourierGap,
} from './_shared.ts';
import { resolveCarrierMethod } from '../../openlinker/delivery-intent-resolution.ts';
import type { DeliveryIntent, GenerateLabelCommand } from '../../openlinker/ol-shipping.types.ts';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out');

/** A trimmed stand-in for the `IncomingOrder` an OrderSourcePort produces. */
interface FakeIncomingOrder {
  id: string;
  recipient: typeof SAMPLE_RECIPIENT;
  pickupPoint: { id: string } | null;
  shippingAddress?: typeof SAMPLE_COURIER_ADDRESS;
}

async function main(): Promise<void> {
  const adapter = buildAdapter();
  const addressMode = process.env.ORDER_MODE === 'address';

  // ── Step 1: order ingestion (OrderSourcePort.getOrder → IncomingOrder) ──────
  banner('1. order ingested from marketplace');
  let pickupPoint: { id: string } | null = null;
  if (!addressMode) {
    const points = await adapter.findPickupPoints({ city: 'Warszawa', limit: 1 });
    pickupPoint = { id: process.env.INPOST_TARGET_POINT ?? points[0]!.providerId };
  }
  const order: FakeIncomingOrder = {
    id: fakeId('order'),
    recipient: SAMPLE_RECIPIENT,
    pickupPoint,
    shippingAddress: addressMode ? SAMPLE_COURIER_ADDRESS : undefined,
  };
  console.log(`  order ${order.id} — ${pickupPoint ? `locker ${pickupPoint.id}` : 'courier to address'}`);

  // ── Step 2: derive intent + resolve carrier method (dispatch seam) ──────────
  banner('2. derive delivery intent → resolve carrier method');
  const intent: DeliveryIntent = order.pickupPoint ? 'pickup_point' : 'address';
  const method = resolveCarrierMethod(intent, adapter.getSupportedMethods());
  if (!method) throw new Error('intent unsatisfiable by carrier');
  console.log(`  intent=${intent} → method=${method}`);

  // ── Step 3: build GenerateLabelCommand + generateLabel (ShipmentDispatchService)
  banner('3. dispatch — generate label');
  const cmd: GenerateLabelCommand = {
    shipmentId: fakeId('shipment'),
    orderId: order.id,
    connectionId: 'conn_inpost_sandbox',
    shippingMethod: method,
    paczkomatId: order.pickupPoint?.id,
    recipient: addressMode ? { ...order.recipient, address: order.shippingAddress } : order.recipient,
    parcel: addressMode
      ? { dimensions: { length: 200, width: 150, height: 100 }, weightGrams: 1200 }
      : { template: 'small' },
  };
  const result = await adapter.generateLabel(cmd);
  console.log('  shipment row → status=generated:', result);

  // ── Step 4: status sync (ShipmentStatusSyncService poll) ────────────────────
  banner('4. status sync poll');
  const snapshot = await adapter.getTracking({ providerShipmentId: result.providerShipmentId });
  console.log('  TrackingSnapshot:', snapshot);

  // ── Step 5: operator downloads label ────────────────────────────────────────
  banner('5. fetch label PDF');
  const doc = await adapter.fetchLabel({ providerShipmentId: result.providerShipmentId });
  await mkdir(outDir, { recursive: true });
  const path = join(outDir, `ol-lifecycle-${result.providerShipmentId}.pdf`);
  await writeFile(path, doc.body);
  console.log(`  ${doc.contentType}, ${doc.body.byteLength} bytes → ${path}`);

  console.log('\n✓ lifecycle complete — order → shipment → label → tracking');
}

main().catch((err) => {
  if (isCourierNotProvisioned(err)) {
    explainCourierGap();
    process.exit(0);
  }
  console.error('failed:', err);
  process.exit(1);
});
