/**
 * Simulates OpenLinker's `PickupPointLookupService`.
 *
 * The buyer picks a locker in the FE; OL searches the provider's pickup-point
 * network via `PickupPointFinder.findPickupPoints(query)` and caches the result.
 * Read-only — costs nothing.
 *
 *   INPOST_TOKEN=… node --experimental-strip-types examples/openlinker/01-pickup-points.ts
 */

import { buildAdapter, banner } from './_shared.ts';

async function main(): Promise<void> {
  const adapter = buildAdapter();

  banner('PickupPointFinder.findPickupPoints — Warszawa');
  const points = await adapter.findPickupPoints({ city: 'Warszawa', limit: 5 });
  console.log(`found ${points.length} pickup points (neutral PickupPoint shape):`);
  for (const p of points) {
    console.log(
      `  ${p.providerId.padEnd(10)} [${p.status}] ${p.address.line1}, ${p.address.postalCode} ${p.address.city}` +
        (p.lat ? ` (${p.lat}, ${p.lon})` : ''),
    );
  }

  banner('supported methods (drives FE capability rendering)');
  console.log(' ', adapter.getSupportedMethods());
}

main().catch((err) => {
  console.error('failed:', err);
  process.exit(1);
});
