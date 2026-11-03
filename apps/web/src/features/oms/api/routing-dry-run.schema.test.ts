import { describe, expect, it } from 'vitest';

import { parseRoutingDryRunResult } from './routing-dry-run.schema';

const evaluation = { candidates: [], unfulfillable: [], explanation: [] };
const input = {
  lines: [{ orderLineId: 'l1', productVariantId: 'v1', quantity: 1 }],
  shipTo: { mode: 'hashed', countryIso2: 'PL', locationHash: 'abc' },
  requestedDeliveryMethod: null,
};

describe('parseRoutingDryRunResult', () => {
  it('should accept the hashed ship-to arm, which carries no postcode', () => {
    const result = parseRoutingDryRunResult({ input, saved: evaluation });

    expect(result.input.shipTo.mode).toBe('hashed');
    expect(result.input.shipTo.locationHash).toBe('abc');
  });

  it('should default an absent score and detail to null', () => {
    const result = parseRoutingDryRunResult({
      input,
      saved: {
        ...evaluation,
        explanation: [{ rule: { ruleId: 'r', name: 'n', displayLabel: 'L' }, eliminated: [] }],
      },
    });

    expect(result.saved.explanation[0]?.score).toBeNull();
    expect(result.saved.explanation[0]?.detail).toBeNull();
  });

  it('should refuse a payload with no saved evaluation', () => {
    expect(() => parseRoutingDryRunResult({ input })).toThrow();
  });
});
