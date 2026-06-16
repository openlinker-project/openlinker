/**
 * Full sandbox flow — the path OpenLinker needs from a ShipX shipping adapter:
 *
 *   resolve org → pick a destination locker → create shipment → (select offer
 *   if needed) → wait for confirmation → download label PDF → read tracking.
 *
 *   INPOST_TOKEN="<sandbox-jwt>" node --experimental-strip-types examples/full-flow.ts
 *
 * Env: INPOST_TOKEN (required), INPOST_BASE (optional), INPOST_ORG_ID (optional),
 *      INPOST_TARGET_POINT (optional — destination locker code).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createInpostShipXClient,
  INPOST_SHIPX_SANDBOX_BASE_URL,
  InpostApiError,
  SHIPMENT_STATUS,
  type CreateShipmentCommand,
} from '../src/index.ts';

const token = process.env.INPOST_TOKEN;
if (!token) {
  console.error('Missing INPOST_TOKEN env var.');
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'out');

const client = createInpostShipXClient({
  token,
  baseUrl: process.env.INPOST_BASE ?? INPOST_SHIPX_SANDBOX_BASE_URL,
  organizationId: process.env.INPOST_ORG_ID,
  logLevel: 'debug',
});

async function resolveTargetLocker(): Promise<string> {
  if (process.env.INPOST_TARGET_POINT) return process.env.INPOST_TARGET_POINT;
  const points = await client.getPoints({ per_page: 1, type: 'parcel_locker', functions: 'parcel_collect' });
  const point = points.items[0];
  if (!point) throw new Error('No parcel_locker point found to use as target_point');
  return point.name;
}

async function main(): Promise<void> {
  console.log('=== InPost ShipX full sandbox flow ===');

  const orgId = await client.resolveOrganizationId();
  console.log(`org: ${orgId}`);

  const targetPoint = await resolveTargetLocker();
  console.log(`target locker: ${targetPoint}`);

  const command: CreateShipmentCommand = {
    receiver: {
      first_name: 'Jan',
      last_name: 'Testowy',
      email: 'jan.testowy@example.com',
      phone: '888000000',
    },
    parcels: [{ template: 'small' }],
    service: 'inpost_locker_standard',
    custom_attributes: {
      target_point: targetPoint,
      sending_method: 'parcel_locker',
    },
    reference: `openlinker-sandbox-${orgId}`,
  };

  console.log('\ncreating shipment…');
  let shipment = await client.createShipment(command, orgId);
  console.log(`  created #${shipment.id} status=${shipment.status}`);

  // ShipX prepares offers asynchronously, then (because we passed a `service`)
  // auto-selects one. Wait until an offer is available/selected.
  console.log('\nwaiting for an offer…');
  shipment = await client.waitForShipmentStatus(
    shipment.id,
    (status, s) =>
      status === SHIPMENT_STATUS.OFFER_SELECTED ||
      !!s.selected_offer ||
      (s.offers?.some((o) => o.status === 'available' || o.status === 'selected') ?? false),
    { timeoutMs: 30_000, intervalMs: 2_000 },
  );

  const offer =
    shipment.selected_offer ??
    shipment.offers?.find((o) => o.status === 'selected' || o.status === 'available') ??
    shipment.offers?.[0];
  if (!offer) throw new Error('No purchasable offer on the shipment');

  // Buy (confirm) the offer — draws on the organization balance.
  console.log(`\nbuying offer #${offer.id}…`);
  shipment = await client.buyShipment(shipment.id, offer.id);

  console.log('\nwaiting for confirmation…');
  shipment = await client.waitForShipmentStatus(
    shipment.id,
    (status, s) => {
      const failed = s.transactions?.find((t) => t.status === 'failure');
      if (failed) {
        throw new Error(
          `Buy failed: ${failed.details?.error ?? 'unknown'} (${failed.details?.message ?? ''}) — ` +
            `check the sandbox account balance in "Płatności".`,
        );
      }
      return status === SHIPMENT_STATUS.CONFIRMED || status === SHIPMENT_STATUS.DISPATCHED_BY_SENDER;
    },
    { timeoutMs: 60_000, intervalMs: 3_000 },
  );
  console.log(`  confirmed #${shipment.id} tracking=${shipment.tracking_number ?? '—'}`);

  console.log('\ndownloading label…');
  const label = await client.getLabel(shipment.id, { format: 'pdf', type: 'normal' });
  await mkdir(outDir, { recursive: true });
  const labelPath = join(outDir, `label-${shipment.id}.pdf`);
  await writeFile(labelPath, label);
  console.log(`  saved ${label.byteLength} bytes → ${labelPath}`);

  if (shipment.tracking_number) {
    console.log('\nreading tracking…');
    try {
      const tracking = await client.getTracking(shipment.tracking_number);
      console.log(`  ${tracking.tracking_number}: ${tracking.status}`);
    } catch (err) {
      if (err instanceof InpostApiError && err.status === 404) {
        console.log('  tracking not available yet (404) — expected for a fresh sandbox shipment');
      } else {
        throw err;
      }
    }
  }

  console.log('\n✓ flow complete');
}

main().catch((err) => {
  if (err instanceof InpostApiError) {
    console.error(`\n✖ InpostApiError ${err.status} [${err.code ?? '—'}]: ${err.message}`);
    console.error('  details:', JSON.stringify(err.details, null, 2));
  } else {
    console.error('\n✖ flow failed:', err);
  }
  process.exit(1);
});
