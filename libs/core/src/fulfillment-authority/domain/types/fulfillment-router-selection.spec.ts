/**
 * `selectPrimaryFulfillmentRouter` (#2395, `W3a-6`, DESIGN §5.3)
 *
 * The A2 half of the #2047 four-part gate: which connection's router may decide
 * where an order is sourced from, and — on every arm — why.
 *
 * Two properties here are worth more than the rest.
 *
 * **The channel-scoped case would have passed against a WRONG implementation.**
 * A2 selection was very nearly written as a single `{ kind: 'global' }` request,
 * which resolves a channel-scoped claim to `none` (the regression D10 shape).
 * No shipped assertion would have caught it: the only `sourcing` assertions are
 * the zero-config default, which a global-only selection also satisfies, and
 * every scope-behaviour test in the sibling spec is written against
 * `availability`. So the channel-scoped tests below are the ones that exist
 * because nothing else covers them.
 *
 * **`reason` is asserted non-null on every arm** — the Wave-2 §7.1 obligation.
 *
 * @module libs/core/src/fulfillment-authority/domain/types
 */
import {
  FulfillmentRouterSelectionReasonValues,
  isFulfillmentRouterAmbiguity,
  resolveAuthorities,
  selectPrimaryFulfillmentRouter,
  type AuthorityClaimantInput,
} from './authority-resolution.types';
import type { AuthorityScope } from './authority-scope.types';

const claimant = (
  connectionId: string,
  sourcing: Record<string, unknown> | undefined,
  isActive = true
): AuthorityClaimantInput => ({
  connectionId,
  isActive,
  // A2 is `config-only`, so capability lists are irrelevant to it by design.
  supportedCapabilities: [],
  enabledCapabilities: [],
  config: sourcing === undefined ? {} : { sourcingAuthority: sourcing },
});

const channel = (id: string): AuthorityScope => ({ kind: 'channel', connectionId: id });

describe('selectPrimaryFulfillmentRouter', () => {
  describe('none', () => {
    it('should report no-claimant when nobody claims sourcing', () => {
      const selection = selectPrimaryFulfillmentRouter([claimant('c-1', undefined)]);

      expect(selection.holder).toBeNull();
      expect(selection.reason).toBe('no-claimant');
      expect(selection.candidateConnectionIds).toEqual([]);
    });

    it('should report no-claimant when the only claimant is inactive', () => {
      // An inactive claimant is REPORTED elsewhere but never eligible, so it can
      // neither hold A2 nor manufacture an ambiguity that blocks routing.
      const selection = selectPrimaryFulfillmentRouter([
        claimant('c-1', { enabled: true }, false),
      ]);

      expect(selection.holder).toBeNull();
      expect(selection.reason).toBe('no-claimant');
    });

    it('should report no-claimant for a malformed config rather than throwing', () => {
      const selection = selectPrimaryFulfillmentRouter([
        { ...claimant('c-1', undefined), config: 'not-an-object' },
      ]);

      expect(selection.reason).toBe('no-claimant');
    });
  });

  describe('selected', () => {
    it('should select a lone claimant regardless of any primary flag', () => {
      // The #2047 zero-config property: an operator who never set a primary must
      // not silently lose the authority.
      const selection = selectPrimaryFulfillmentRouter([claimant('c-1', { enabled: true })]);

      expect(selection.holder).toBe('c-1');
      expect(selection.reason).toBe('claimed-by-connection');
    });

    it('should select the single primary among several global claimants', () => {
      const selection = selectPrimaryFulfillmentRouter([
        claimant('c-1', { enabled: true }),
        claimant('c-2', { enabled: true, isPrimary: true }),
      ]);

      expect(selection.holder).toBe('c-2');
      expect(selection.reason).toBe('claimed-by-connection');
    });

    it('should select a CHANNEL-SCOPED claimant — never resolving it to none', () => {
      // The regression this spec exists for. A single `global` request drops a
      // channel-scoped claim into neither tier and answers `none`, so routing
      // would silently never happen on the shape A2 is DESIGNED around.
      const selection = selectPrimaryFulfillmentRouter([
        claimant('c-1', { enabled: true, scopes: [channel('shop-a')] }),
      ]);

      expect(selection.holder).toBe('c-1');
      expect(selection.reason).toBe('claimed-by-connection');
    });

    it('should select one holder claiming several scopes', () => {
      const selection = selectPrimaryFulfillmentRouter([
        claimant('c-1', { enabled: true, scopes: [channel('shop-a'), channel('shop-b')] }),
      ]);

      expect(selection.holder).toBe('c-1');
      expect(selection.reason).toBe('claimed-by-connection');
    });
  });

  describe('refusing to commit', () => {
    it('should refuse when two claimants share one scope and neither is primary', () => {
      const selection = selectPrimaryFulfillmentRouter([
        claimant('c-1', { enabled: true }),
        claimant('c-2', { enabled: true }),
      ]);

      expect(selection.holder).toBeNull();
      expect(selection.reason).toBe('multiple-claimants-same-scope');
      expect(selection.candidateConnectionIds).toEqual(['c-1', 'c-2']);
    });

    it('should refuse when several claimants declare themselves primary', () => {
      const selection = selectPrimaryFulfillmentRouter([
        claimant('c-1', { enabled: true, isPrimary: true }),
        claimant('c-2', { enabled: true, isPrimary: true }),
      ]);

      expect(selection.holder).toBeNull();
      expect(selection.reason).toBe('multiple-primaries');
    });

    it('should refuse when two routers hold DIFFERENT scopes', () => {
      // Not a misconfiguration — it is a legitimate compound the A2 row renders.
      // Routing still refuses: it needs ONE router for one order and cannot
      // narrow by channel in Wave 3a. Reported, never resolved arbitrarily,
      // because a wrong pick is a double shipment.
      const selection = selectPrimaryFulfillmentRouter([
        claimant('c-1', { enabled: true, scopes: [channel('shop-a')] }),
        claimant('c-2', { enabled: true, scopes: [channel('shop-b')] }),
      ]);

      expect(selection.holder).toBeNull();
      expect(selection.reason).toBe('multiple-scoped-holders');
      expect(selection.candidateConnectionIds).toEqual(['c-1', 'c-2']);
      // Both are still named, so the surface can render the compound.
      expect(selection.holders).toHaveLength(2);
    });
  });

  describe('the Wave-2 §7.1 obligation', () => {
    it('should carry a non-null, declared reason on every arm', () => {
      const arms = [
        selectPrimaryFulfillmentRouter([]),
        selectPrimaryFulfillmentRouter([claimant('c-1', { enabled: true })]),
        selectPrimaryFulfillmentRouter([
          claimant('c-1', { enabled: true }),
          claimant('c-2', { enabled: true }),
        ]),
        selectPrimaryFulfillmentRouter([
          claimant('c-1', { enabled: true, scopes: [channel('shop-a')] }),
          claimant('c-2', { enabled: true, scopes: [channel('shop-b')] }),
        ]),
      ];

      for (const selection of arms) {
        expect(selection.reason).not.toBeNull();
        expect(FulfillmentRouterSelectionReasonValues).toContain(selection.reason);
      }
      // Non-vacuity: the arms really are distinct outcomes, not four defaults.
      expect(new Set(arms.map((a) => a.reason)).size).toBe(4);
    });

    it('should classify a legitimate compound as needing attention, and a lone holder as not', () => {
      expect(isFulfillmentRouterAmbiguity('claimed-by-connection')).toBe(false);
      expect(isFulfillmentRouterAmbiguity('no-claimant')).toBe(false);
      expect(isFulfillmentRouterAmbiguity('multiple-scoped-holders')).toBe(true);
      expect(isFulfillmentRouterAmbiguity('multiple-primaries')).toBe(true);
    });
  });

  describe('#2351 A2 consumes this selection', () => {
    const a2 = (claimants: AuthorityClaimantInput[]) =>
      resolveAuthorities({ claimants }).find((row) => row.question === 'sourcing');

    it('should answer A2 from the selection rather than from a default', () => {
      const row = a2([claimant('c-1', { enabled: true })]);

      // The point of the criterion: the row moved off its default BECAUSE a
      // router is configured.
      expect(row?.source).toBe('operator-config');
      expect(row?.answer).toEqual({
        kind: 'holders',
        holders: [{ connectionId: 'c-1', scope: { kind: 'global' } }],
      });
      expect(row?.state).toBe('resolved');
    });

    it('should keep the default answer when the selection reports no claimant', () => {
      const row = a2([claimant('c-1', undefined)]);

      expect(row?.answer).toEqual({ kind: 'nobody-to-route' });
      expect(row?.source).toBe('default');
    });

    it('should render a legitimate compound as holders, NOT as cannot-tell', () => {
      const row = a2([
        claimant('c-1', { enabled: true, scopes: [channel('shop-a')] }),
        claimant('c-2', { enabled: true, scopes: [channel('shop-b')] }),
      ]);

      // Routing refuses this set, but the surface must not shout about it: a
      // compound is routine, and `cannot-tell` is reserved for a real
      // misconfiguration.
      expect(row?.answer.kind).toBe('holders');
      expect(row?.state).toBe('resolved');
    });

    it('should report a real misconfiguration as cannot-tell', () => {
      const row = a2([
        claimant('c-1', { enabled: true }),
        claimant('c-2', { enabled: true }),
      ]);

      expect(row?.answer.kind).toBe('cannot-tell');
      expect(row?.state).toBe('ambiguous');
    });
  });
});
