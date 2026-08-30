import { readFileSync } from 'fs';
import { join } from 'path';

import {
  ROUTING_INPUT_ALLOWED_KEYS,
  ROUTING_INPUT_FORBIDDEN_KEYS,
  ROUTING_INPUT_LINE_ALLOWED_KEYS,
  RoutingUnfulfillableResolutionValues,
  type RoutingEvaluation,
  type RoutingInput,
  type RoutingInputLine,
} from './routing.types';

/**
 * The guard the exported allowlists exist for.
 *
 * A runtime `Object.keys()` comparison alone is NOT a guard for `RoutingInput`:
 * the fixture it reads is declared by this spec, so a field added to the
 * interface leaves the fixture untouched and the assertion green. (The ship-to
 * side is genuinely structural because it compares against `buildRoutingShipTo`'s
 * real output; there is no such producer for `RoutingInput`.) `Exclude` over the
 * declared keys closes it: any field not in the allowlist makes this a `tsc`
 * error, which is what makes widening the projection a real two-place edit.
 */
type UnallowedInputKeys = Exclude<keyof RoutingInput, (typeof ROUTING_INPUT_ALLOWED_KEYS)[number]>;
const _noUnallowedInputKeys: UnallowedInputKeys extends never ? true : never = true;

type UnallowedLineKeys = Exclude<
  keyof RoutingInputLine,
  (typeof ROUTING_INPUT_LINE_ALLOWED_KEYS)[number]
>;
const _noUnallowedLineKeys: UnallowedLineKeys extends never ? true : never = true;

/** Compile-time guards. A failure here is a `tsc` error, not a red assertion. */
type ForbiddenInputKeys = Extract<
  keyof RoutingInput,
  'name' | 'email' | 'phone' | 'buyerEmail' | 'order' | 'billingAddress'
>;
const _noForbiddenInputKeys: ForbiddenInputKeys extends never ? true : never = true;

type ForbiddenLineKeys = Extract<keyof RoutingInputLine, 'name' | 'email' | 'phone' | 'price'>;
const _noForbiddenLineKeys: ForbiddenLineKeys extends never ? true : never = true;

/**
 * The one assertion that carries `evaluate()`'s non-committing contract: no
 * committing identifier can come back off that path, so no caller can persist a
 * decision from it.
 */
type CommittingEvaluationKeys = Extract<keyof RoutingEvaluation, 'decisionId' | 'holds'>;
const _noCommittingEvaluationKeys: CommittingEvaluationKeys extends never ? true : never = true;

describe('routing.types', () => {
  const line: RoutingInputLine = {
    orderLineId: 'line-1',
    productVariantId: 'ol_variant_abc',
    quantity: 2,
  };

  const input: RoutingInput = {
    orderId: 'ol_order_abc',
    lines: [line],
    shipTo: { mode: 'plain', countryIso2: 'PL', postalCode: '00-001', city: 'Warszawa' },
    requestedDeliveryMethod: 'courier',
  };

  it('should keep the compile-time guards referenced', () => {
    expect(_noForbiddenInputKeys).toBe(true);
    expect(_noForbiddenLineKeys).toBe(true);
    expect(_noCommittingEvaluationKeys).toBe(true);
    expect(_noUnallowedInputKeys).toBe(true);
    expect(_noUnallowedLineKeys).toBe(true);
  });

  describe('RoutingInput allowlist', () => {
    it('should carry exactly the allowlisted top-level keys', () => {
      expect(Object.keys(input).sort()).toEqual([...ROUTING_INPUT_ALLOWED_KEYS].sort());
    });

    it('should carry exactly the allowlisted line keys', () => {
      expect(Object.keys(line).sort()).toEqual([...ROUTING_INPUT_LINE_ALLOWED_KEYS].sort());
    });

    it('should declare no forbidden buyer-identifying key on the input or its lines', () => {
      for (const forbidden of ROUTING_INPUT_FORBIDDEN_KEYS) {
        expect(ROUTING_INPUT_ALLOWED_KEYS).not.toContain(forbidden);
        expect(ROUTING_INPUT_LINE_ALLOWED_KEYS).not.toContain(forbidden);
      }
    });

    /**
     * The allowlist is only a guard while it is a SECOND place to edit. This
     * catches a field added to the interface and not to the array.
     */
    it('should not declare a forbidden key as a property in the source', () => {
      const source = readFileSync(join(__dirname, 'routing.types.ts'), 'utf8');
      const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');

      for (const forbidden of ['buyerEmail', 'customerEmail', 'buyerPhone', 'billingAddress']) {
        expect(withoutComments).not.toContain(`readonly ${forbidden}`);
      }
    });
  });

  describe('unfulfillable resolution', () => {
    it('should be closed at line-scoped refund and return', () => {
      expect(RoutingUnfulfillableResolutionValues).toEqual(['refund', 'return']);
    });
  });
});
