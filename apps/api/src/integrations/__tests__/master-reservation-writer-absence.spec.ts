/**
 * `MasterReservationWriter` Absence Guard (#2403)
 *
 * `MasterReservationWriter` is a NAMED DEFERRAL, not an oversight: #2315 /
 * ADR-061 removed master-side reservation from `InventoryMasterPort` and parked
 * the legitimate residual need — pushing a hold to a master that really does
 * model one — behind this name, "deliberately deferred until an adapter exists
 * that can implement it". Advertising a capability with no implementer is what
 * ADR-048 decision 1 forbids, so until that adapter exists the name must appear
 * in NO manifest and in NO capability list.
 *
 * This spec lives in `apps/api` rather than `libs/core` for a hard reason: it
 * asserts over the real adapter manifests, and `libs/core` may not depend on an
 * integration package — that would reverse the CORE -> Integration dependency
 * direction. `apps/api` already declares every integration it ships.
 *
 * ## It asserts MEMBERSHIP, never the presence of a string
 *
 * The literal `MasterReservationWriter` legitimately appears in prose at
 * `libs/core/src/inventory/domain/ports/inventory-master.port.ts` (lines ~166
 * and ~189) — the ADR-061 deprecation docblock that RECORDS the deferral. A
 * filesystem scan for the string would therefore be red on day one and would
 * get "fixed" by weakening it, which is exactly how a mirror silently becomes a
 * no-op. Do not convert this into a text scan. If a future reader wants wider
 * coverage, widen the MANIFEST list below, never the matching strategy.
 *
 * That list is hand-maintained, so it can go stale: a NEW integration package
 * added without an entry here is simply not swept, and the `>= 10` floor below
 * is a guard against an accidentally-emptied list, not a completeness proof.
 * Deriving it from the filesystem was rejected — it would reintroduce the
 * text-scanning this spec exists to avoid — so the honest mitigation is to add
 * the manifest here when a new integration lands.
 *
 * ## It reads BUILT output, and that fails OPEN
 *
 * These manifests resolve through each package's `dist`, so editing a manifest
 * in `src` without rebuilding leaves this spec asserting over the OLD value —
 * and because it is an ABSENCE check, a stale read is GREEN when it should be
 * red. Verified the hard way while writing it: adding the name to erli's `src`
 * left all four tests passing until `pnpm --dir libs/integrations/erli build`
 * ran, after which the sweep failed correctly. The root `pnpm test` gate builds
 * first, so CI is sound; when checking this guard BY HAND, rebuild the package
 * you edited or you are reading yesterday's manifest.
 *
 * @module apps/api/src/integrations/__tests__
 */
import { CoreCapabilityValues } from '@openlinker/core/integrations';
import type { AdapterMetadata } from '@openlinker/core/integrations';

import { allegroAdapterManifest } from '@openlinker/integrations-allegro';
import { dpdAdapterManifest } from '@openlinker/integrations-dpd-polska';
import { eparagonyAdapterManifest } from '@openlinker/integrations-eparagony';
import { erliAdapterManifest } from '@openlinker/integrations-erli';
import { infaktAdapterManifest } from '@openlinker/integrations-infakt';
import { inpostAdapterManifest } from '@openlinker/integrations-inpost';
import { ksefAdapterManifest } from '@openlinker/integrations-ksef';
import { prestashopAdapterManifest } from '@openlinker/integrations-prestashop';
import { subiektAdapterManifest } from '@openlinker/integrations-subiekt';
import { woocommerceAdapterManifest } from '@openlinker/integrations-woocommerce';

const DEFERRED_CAPABILITY = 'MasterReservationWriter';

/** Every in-tree adapter manifest, by the name an operator would recognise. */
const MANIFESTS: ReadonlyArray<readonly [string, AdapterMetadata]> = [
  ['allegro', allegroAdapterManifest],
  ['dpd-polska', dpdAdapterManifest],
  ['eparagony', eparagonyAdapterManifest],
  ['erli', erliAdapterManifest],
  ['infakt', infaktAdapterManifest],
  ['inpost', inpostAdapterManifest],
  ['ksef', ksefAdapterManifest],
  ['prestashop', prestashopAdapterManifest],
  ['subiekt', subiektAdapterManifest],
  ['woocommerce', woocommerceAdapterManifest],
];

/** The predicate under test, lifted so the positive control can exercise it. */
function advertises(manifest: AdapterMetadata, capability: string): boolean {
  return manifest.supportedCapabilities.includes(capability);
}

describe('MasterReservationWriter (deferred — #2315 / ADR-061)', () => {
  it('should have a detector that actually detects (positive control)', () => {
    // Without this, a predicate broken by a later edit would make both
    // assertions below pass vacuously — the failure mode an "absence"
    // assertion cannot see on its own.
    const fabricated: AdapterMetadata = {
      adapterKey: 'fabricated.v1',
      platformType: 'fabricated',
      supportedCapabilities: [DEFERRED_CAPABILITY],
    };
    expect(advertises(fabricated, DEFERRED_CAPABILITY)).toBe(true);
    expect(advertises(allegroAdapterManifest, DEFERRED_CAPABILITY)).toBe(false);
  });

  it('should cover every in-tree manifest (guard against a silently empty sweep)', () => {
    expect(MANIFESTS.length).toBeGreaterThanOrEqual(10);
    for (const [, manifest] of MANIFESTS) {
      expect(Array.isArray(manifest.supportedCapabilities)).toBe(true);
    }
  });

  it('should be advertised by no adapter manifest', () => {
    const offenders = MANIFESTS.filter(([, manifest]) =>
      advertises(manifest, DEFERRED_CAPABILITY),
    ).map(([name]) => name);

    expect(offenders).toEqual([]);
  });

  it('should not be a well-known core capability', () => {
    expect([...CoreCapabilityValues]).not.toContain(DEFERRED_CAPABILITY);
  });
});
