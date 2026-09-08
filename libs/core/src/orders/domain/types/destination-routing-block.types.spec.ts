/**
 * #2703 / #2704 — the destination-routing reason vocabulary.
 *
 * The assertions that matter here are about the COUNTED SUBSET, because getting
 * it wrong is invisible until an operator sees a red badge on a healthy install.
 */
import {
  DestinationRoutingAttentionReasonValues,
  DestinationRoutingBlockReasonValues,
  buildDestinationRoutingDetail,
  isDestinationRoutingBlockReason,
} from './destination-routing-block.types';

describe('destination-routing block vocabulary', () => {
  describe('the counted subset', () => {
    it('should exclude routed-to-no-destination when listing attention-worthy reasons', () => {
      // The #2100 `trigger-model-manual` rule: a working router deciding an
      // order goes nowhere is a DECISION, and counting it would put a permanent
      // red badge on an install that legitimately routes some orders nowhere.
      expect(DestinationRoutingAttentionReasonValues).not.toContain('routed-to-no-destination');
    });

    it('should count every reason that names an unreachable destination', () => {
      expect([...DestinationRoutingAttentionReasonValues].sort()).toEqual(
        [
          'routed-destinations-partially-unavailable',
          'routed-destinations-unavailable',
          'routed-to-source-only',
        ].sort()
      );
    });

    it('should be a strict subset of the full vocabulary', () => {
      // Derived by `.filter`, so this cannot drift — but assert it, because a
      // hand-written list is the obvious "simplification" a later reader makes.
      for (const reason of DestinationRoutingAttentionReasonValues) {
        expect(DestinationRoutingBlockReasonValues).toContain(reason);
      }
      expect(DestinationRoutingAttentionReasonValues.length).toBeLessThan(
        DestinationRoutingBlockReasonValues.length
      );
    });
  });

  describe('isDestinationRoutingBlockReason', () => {
    it.each(DestinationRoutingBlockReasonValues)('should recognise %s', (reason) => {
      expect(isDestinationRoutingBlockReason(reason)).toBe(true);
    });

    it('should reject a value written by a newer release when it is not recognised', () => {
      // The column is plain `text` with no CHECK, so a rolled-back deploy must
      // read as "nothing recognised" rather than widening the union at runtime.
      expect(isDestinationRoutingBlockReason('routed-somewhere-new')).toBe(false);
    });

    it.each([null, undefined, 42, {}, []])('should reject the non-string %p', (value) => {
      expect(isDestinationRoutingBlockReason(value)).toBe(false);
    });
  });

  describe('buildDestinationRoutingDetail', () => {
    it('should return null when no destination went unresolved', () => {
      expect(buildDestinationRoutingDetail([])).toBeNull();
    });

    it('should name the unresolved connection ids when there are few', () => {
      expect(buildDestinationRoutingDetail(['conn-a', 'conn-b'])).toBe(
        '2 unresolved destination(s): conn-a, conn-b'
      );
    });

    it('should bound the listed ids and still state the true total when there are many', () => {
      // The ids come from a routing decision OL does not author and the value is
      // rendered verbatim, so the string is bounded — but truncation must never
      // hide the scale, which is why the total is stated first.
      const ids = Array.from({ length: 25 }, (_, index) => `conn-${index}`);

      const detail = buildDestinationRoutingDetail(ids);

      expect(detail).toContain('25 unresolved destination(s)');
      expect(detail).toContain('and 15 more');
      expect(detail).toContain('conn-0');
      expect(detail).not.toContain('conn-24');
    });

    it('should carry no buyer data, only ids and counts', () => {
      const detail = buildDestinationRoutingDetail(['conn-a']);

      expect(detail).toBe('1 unresolved destination(s): conn-a');
    });
  });
});
