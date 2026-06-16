/**
 * Simulates `ShipmentDispatchService` for an address (courier) order.
 *
 * Same dispatch path as 02 but intent=address → method=kurier, which exercises
 * the courier branch of the adapter (recipient address required, parcel by
 * dimensions+weight instead of a locker template).
 *
 *   INPOST_TOKEN=… node --experimental-strip-types examples/openlinker/05-dispatch-kurier.ts
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

async function main(): Promise<void> {
  const adapter = buildAdapter();

  const intent: DeliveryIntent = 'address';
  const method = resolveCarrierMethod(intent, adapter.getSupportedMethods());
  banner(`dispatch: intent=${intent} → method=${method}`);
  if (method !== 'kurier') throw new Error(`unexpected method ${method}`);

  const cmd: GenerateLabelCommand = {
    shipmentId: fakeId('shipment'),
    orderId: fakeId('order'),
    connectionId: 'conn_inpost_sandbox',
    shippingMethod: method,
    recipient: { ...SAMPLE_RECIPIENT, address: SAMPLE_COURIER_ADDRESS },
    parcel: { dimensions: { length: 200, width: 150, height: 100 }, weightGrams: 1200 },
  };
  console.log('command:', {
    shipmentId: cmd.shipmentId,
    method: cmd.shippingMethod,
    to: `${cmd.recipient.address!.street} ${cmd.recipient.address!.buildingNumber}, ${cmd.recipient.address!.city}`,
  });

  const result = await adapter.generateLabel(cmd);
  banner('GenerateLabelResult');
  console.log(result);

  const doc = await adapter.fetchLabel({ providerShipmentId: result.providerShipmentId });
  await mkdir(outDir, { recursive: true });
  const path = join(outDir, `ol-kurier-${result.providerShipmentId}.pdf`);
  await writeFile(path, doc.body);
  console.log(`\nlabel: ${doc.contentType}, ${doc.body.byteLength} bytes → ${path}`);
}

main().catch((err) => {
  if (isCourierNotProvisioned(err)) {
    explainCourierGap();
    process.exit(0);
  }
  console.error('failed:', err);
  process.exit(1);
});
