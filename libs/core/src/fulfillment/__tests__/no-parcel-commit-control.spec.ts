/**
 * The parcel closes itself; nothing closes it (#2418, D18 / story E5)
 *
 * *"The parcel closes when the last item is verified… with no separate
 * confirmation step."* The field is near-unanimous on this and D18 records it as
 * overriding an earlier recommendation for a deliberate commit.
 *
 * A "Done" button is the single most likely thing to be added back — by a
 * reviewer asking for a confirmation step, or by an implementer who finds the
 * auto-close surprising. This spec makes that addition fail a test named for the
 * decision, at the layer where it would have to start: **there is no method to
 * wire a button to.**
 *
 * It reads the SOURCE of the two seams a close could be exposed through rather
 * than their types, because a type test would pass on a method added and then
 * cast away, and because the failure message needs to name the decision.
 *
 * The complement is the frontend's own assertion that no such control renders
 * (`apps/web/.../bench-parcel.test.tsx`, which pins the whole PERMITTED set of
 * button names rather than a denied word list) and the API's that no such route
 * exists (`apps/api/src/bench/__tests__/no-parcel-commit-route.spec.ts`, which
 * enumerates every bench write off Nest's own route metadata). Three layers,
 * because a commit control can be introduced at any of them — and all three are
 * now assertions rather than two assertions and a sentence (#2905).
 *
 * @module libs/core/src/fulfillment/__tests__
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CONTEXT_ROOT = join(__dirname, '..');

const SEAMS = [
  join(CONTEXT_ROOT, 'application', 'interfaces', 'fulfillment-verification.service.interface.ts'),
  join(CONTEXT_ROOT, 'domain', 'types', 'fulfillment-verification.types.ts'),
];

/**
 * Names a close could plausibly arrive under. Matched as a METHOD or type
 * declaration, not as prose: every one of these files explains at length why
 * there is no close, and matching the explanation would make the guard
 * unpassable.
 */
const FORBIDDEN_DECLARATIONS = [
  /\bcloseParcel\s*\(/,
  /\bcloseParcel\s*:/,
  /\bconfirmParcel\s*\(/,
  /\bcommitParcel\s*\(/,
  /\bfinishParcel\s*\(/,
  /\binterface\s+CloseParcelInput\b/,
];

describe('there is no commit control on the parcel seam (#2418, D18)', () => {
  it.each(SEAMS)('%s declares no close operation', (file) => {
    const source = readFileSync(file, 'utf8');
    // Non-vacuity: an unreadable or renamed file would otherwise pass silently.
    expect(source.length).toBeGreaterThan(0);

    for (const pattern of FORBIDDEN_DECLARATIONS) {
      expect(
        pattern.test(source)
          ? `${file} declares ${pattern.source}. Decision D18: the parcel closes on the LAST ` +
              'VERIFICATION, with no confirmation step — the close happens inside `verifyUnit`, ' +
              'and a control that closes a box is exactly what the bench must not have. If this ' +
              'is deliberate, it is an amendment to D18 and belongs in the spec first.'
          : null
      ).toBeNull();
    }
  });

  it('exposes verify and reopen, so the guard above is not vacuous', () => {
    const source = readFileSync(SEAMS[0], 'utf8');
    expect(source).toContain('verifyUnit(');
    expect(source).toContain('reopenParcel(');
  });
});
