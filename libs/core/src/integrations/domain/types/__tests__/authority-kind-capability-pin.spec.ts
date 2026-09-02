/**
 * Authority-Kind Capability Pin (#2403, readiness-gate finding W1)
 *
 * `AUTHORITY_KIND_DESCRIPTORS` names, per authority, the adapter capability
 * that gates it — or the literal `'config-only'` where no capability does.
 * `AuthorityKindDescriptor.capability` is typed bare `string`, and
 * `scripts/check-authority-kind-mirror.mjs` pins those strings only against the
 * table in `docs/`, never against the registry. That was defensible while the
 * names were not well-known.
 *
 * Since #2403 two of them ARE well-known (`AvailabilityAuthority` for A1,
 * `FulfillmentExecutor` for A3), so a typo — `'AvailabiltyAuthority'` — would
 * type-check, satisfy BOTH existing mirror scripts, and silently disable the
 * gate it was supposed to name. Nothing would fail; the authority would simply
 * never resolve. This spec closes that by asserting the one relationship
 * neither script owns: every gating capability is a real registry member.
 *
 * Deliberately a SPEC and not a clause in `check-authority-kind-mirror.mjs` —
 * REVIEW H8a assigns that script's evolution to #2311, and two guards on one
 * fact can disagree.
 *
 * `'config-only'` is exempt BY DESIGN, not by omission: it is the sentinel for
 * "no adapter capability gates this authority" (A2 sourcing, A4 order-lifecycle,
 * A6 refund-trigger), and `resolveAuthorities` branches on that exact literal to
 * skip the `supportedCapabilities` gate. Asserting it were a registry member
 * would be asserting the opposite of what it means.
 *
 * @module libs/core/src/integrations/domain/types/__tests__
 */
import { AUTHORITY_KIND_DESCRIPTORS } from '@openlinker/core/fulfillment-authority';

import { CoreCapabilityValues } from '../adapter.types';

/** The sentinel meaning "no adapter capability gates this authority". */
const CONFIG_ONLY = 'config-only';

/** The predicate under test, lifted so the positive control can exercise it. */
function isGatedByRegistryMember(capability: string): boolean {
  return (
    capability === CONFIG_ONLY || (CoreCapabilityValues as readonly string[]).includes(capability)
  );
}

describe('AUTHORITY_KIND_DESCRIPTORS capability pin', () => {
  it('should have a detector that actually detects (positive control)', () => {
    // Without this, a predicate broken by a later edit would make the sweep
    // below pass vacuously.
    expect(isGatedByRegistryMember('AvailabilityAuthority')).toBe(true);
    expect(isGatedByRegistryMember(CONFIG_ONLY)).toBe(true);
    // The exact defect this spec exists to catch: a one-character typo.
    expect(isGatedByRegistryMember('AvailabiltyAuthority')).toBe(false);
    expect(isGatedByRegistryMember('')).toBe(false);
  });

  it('should sweep every declared authority kind (guard against an empty sweep)', () => {
    expect(Object.keys(AUTHORITY_KIND_DESCRIPTORS).length).toBeGreaterThan(0);
  });

  it('should name only real core capabilities as gates', () => {
    const offenders = Object.entries(AUTHORITY_KIND_DESCRIPTORS)
      .filter(([, descriptor]) => !isGatedByRegistryMember(descriptor.capability))
      .map(([kind, descriptor]) => `${kind} -> '${descriptor.capability}'`);

    expect(offenders).toEqual([]);
  });

  it('should still gate at least one authority on a real capability', () => {
    // If every row degraded to 'config-only', the assertion above would pass
    // while pinning nothing at all.
    const gated = Object.values(AUTHORITY_KIND_DESCRIPTORS).filter(
      (descriptor) => descriptor.capability !== CONFIG_ONLY,
    );
    expect(gated.length).toBeGreaterThan(0);
  });
});
