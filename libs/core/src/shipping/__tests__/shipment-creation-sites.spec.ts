/**
 * "The OMS mints no shipments" (#2402 AC-1)
 *
 * ## The AC is reinterpreted, deliberately, and this is the honest form
 *
 * #2402 words AC-1 as *"no code path outside `ShipmentDispatchService` creates a
 * shipment"*. That was **already false on `main` before this change**: there are
 * TWO creation sites, and DESIGN §5.5 itself names the second one as where a 3PL
 * shipment comes from — the ADR-012 branch-1 observed row.
 *
 * So the guarantee actually worth holding is that the OMS bridge adds no THIRD
 * site. That is what this asserts, by pinning the exact set: a new creation site
 * fails here and must justify itself, and REMOVING one fails too, so the list
 * cannot rot into a rubber stamp.
 *
 * ## What this test is NOT
 *
 * It is a supplementary, convention-level check — it greps for one call shape and
 * would miss a new repository method, a direct `save()`, or a site in
 * `apps/worker`. The STRUCTURAL guarantee that the fulfilment context cannot mint
 * a shipment is held elsewhere and for free: `libs/core/src/fulfillment` is a
 * registered zero-sibling-edge leaf in `barrel-purity.spec.ts`, so it cannot
 * import `@openlinker/core/shipping` at all — not even type-only.
 *
 * @module libs/core/src/shipping/__tests__
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SHIPPING_ROOT = join(__dirname, '..');

/**
 * Every file that may call `ShipmentRepositoryPort.create`. One entry per site,
 * with the reason it is allowed to mint a row.
 */
const AUTHORIZED_CREATION_SITES = [
  // The label-generating branch (#835). Owns `resolve()`, the per-order lock and
  // the payment gate.
  'application/services/shipment-dispatch.service.ts',
  // The ADR-012 branch-1 OBSERVED row (#834) — a 3PL shipping under its own
  // contract. Named by DESIGN §5.5 as the 3PL source, and it never writes a
  // `providerShipmentId`, which is #2402 AC-2.
  'application/services/fulfillment-status-sync.service.ts',
] as const;

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectSourceFiles(full, acc);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) acc.push(full);
  }
  return acc;
}

describe('shipment creation sites', () => {
  const files = collectSourceFiles(SHIPPING_ROOT);

  it('should find source files to inspect (an empty walk must fail, not vacuously pass)', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('should mint shipments from exactly the two authorized sites — no third', () => {
    const found = files
      // ONE regex, not two chained ones: two independent file-scope filters
      // would qualify a file that happens to contain each pattern in unrelated
      // places, which is not the property this test claims to check.
      .filter((file) => /shipments\.create\(\s*\{/.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(SHIPPING_ROOT.length + 1).split('\\').join('/'))
      .sort();

    expect(found).toEqual([...AUTHORIZED_CREATION_SITES].sort());
  });
});
