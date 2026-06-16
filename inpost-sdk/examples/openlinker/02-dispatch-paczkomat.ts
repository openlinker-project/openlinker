/**
 * Simulates OpenLinker's `ShipmentDispatchService` for a paczkomat order.
 *
 * Flow mirrors the real service: derive delivery intent → resolve the carrier's
 * concrete method from `getSupportedMethods()` → build a `GenerateLabelCommand`
 * → `adapter.generateLabel()` → persist `{ providerShipmentId, trackingNumber,
 * labelPdfRef }`. Then `fetchLabel()` and save the PDF (what the operator
 * downloads).
 *
 * Costs sandbox balance (creates + buys a real sandbox shipment).
 *
 *   INPOST_TOKEN=… node --experimental-strip-types examples/openlinker/02-dispatch-paczkomat.ts
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildAdapter, banner, fakeId, SAMPLE_RECIPIENT } from './_shared.ts';
import { resolveCarrierMethod } from '../../openlinker/delivery-intent-resolution.ts';
import type { DeliveryIntent, GenerateLabelCommand } from '../../openlinker/ol-shipping.types.ts';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out');

async function main(): Promise<void> {
  const adapter = buildAdapter();

  // 1. The buyer selected a locker on the marketplace → intent is pickup_point.
  const intent: DeliveryIntent = 'pickup_point';
  const points = await adapter.findPickupPoints({ city: 'Warszawa', limit: 1 });
  const lockerId = process.env.INPOST_TARGET_POINT ?? points[0]?.providerId;
  if (!lockerId) throw new Error('no locker resolved');

  // 2. Seam resolves intent → carrier method using the adapter's supported set.
  const method = resolveCarrierMethod(intent, adapter.getSupportedMethods());
  banner(`dispatch: intent=${intent} → method=${method}, locker=${lockerId}`);
  if (method !== 'paczkomat') throw new Error(`unexpected method ${method}`);

  // 3. Build the carrier-neutral command (what the dispatch service assembles).
  const cmd: GenerateLabelCommand = {
    shipmentId: fakeId('shipment'),
    orderId: fakeId('order'),
    connectionId: 'conn_inpost_sandbox',
    shippingMethod: method,
    paczkomatId: lockerId,
    recipient: SAMPLE_RECIPIENT,
    parcel: { template: 'small' },
  };
  console.log('command:', { shipmentId: cmd.shipmentId, method: cmd.shippingMethod, locker: cmd.paczkomatId });

  // 4. generateLabel (create → buy → confirm under the hood in sandbox).
  const result = await adapter.generateLabel(cmd);
  banner('GenerateLabelResult');
  console.log(result);

  // 5. Operator downloads the label.
  const doc = await adapter.fetchLabel({ providerShipmentId: result.providerShipmentId });
  await mkdir(outDir, { recursive: true });
  const path = join(outDir, `ol-paczkomat-${result.providerShipmentId}.pdf`);
  await writeFile(path, doc.body);
  console.log(`\nlabel: ${doc.contentType}, ${doc.body.byteLength} bytes → ${path}`);

  console.log('\nNEXT (status sync): node --experimental-strip-types examples/openlinker/03-status-sync.ts ' + result.providerShipmentId);
}

main().catch((err) => {
  console.error('failed:', err);
  process.exit(1);
});
