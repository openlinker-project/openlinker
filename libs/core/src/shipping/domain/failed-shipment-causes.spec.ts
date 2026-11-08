import {
  groupFailedShipmentCauses,
  isExactProviderCode,
  normaliseErrorMessage,
  type FailedShipmentFacts,
} from './failed-shipment-causes';

function failure(overrides: Partial<FailedShipmentFacts> = {}): FailedShipmentFacts {
  return {
    connectionId: 'conn-inpost',
    providerCode: null,
    errorMessage: 'Receiver phone is invalid',
    ...overrides,
  };
}

describe('groupFailedShipmentCauses', () => {
  it('should group by an exact provider code even when the messages differ', () => {
    const groups = groupFailedShipmentCauses([
      failure({ providerCode: 'preflight.missing-parcel-template', errorMessage: 'No parcel template A' }),
      failure({ providerCode: 'preflight.missing-parcel-template', errorMessage: 'Template missing for B' }),
    ]);

    expect(groups).toEqual([
      expect.objectContaining({ providerCode: 'preflight.missing-parcel-template', count: 2 }),
    ]);
  });

  it('should group a coarse or absent code by its normalised message', () => {
    const groups = groupFailedShipmentCauses([
      failure({ errorMessage: 'Receiver phone 600100200 is invalid' }),
      failure({ errorMessage: 'Receiver phone 700300400 is invalid!' }),
      failure({ errorMessage: 'Parcel too heavy' }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ count: 2, sampleReason: 'Receiver phone 600100200 is invalid' });
  });

  it('should keep the same cause on two connections as two groups', () => {
    const groups = groupFailedShipmentCauses([
      failure({ connectionId: 'a' }),
      failure({ connectionId: 'a' }),
      failure({ connectionId: 'b' }),
      failure({ connectionId: 'b' }),
    ]);

    expect(groups.map((g) => g.connectionId).sort()).toEqual(['a', 'b']);
  });

  it('should drop single failures, messages too short to group on, and failures without a message', () => {
    const groups = groupFailedShipmentCauses([
      failure({ errorMessage: 'Only once' }),
      failure({ errorMessage: '42' }),
      failure({ errorMessage: '43' }),
      failure({ errorMessage: null }),
      failure({ errorMessage: null }),
    ]);

    expect(groups).toEqual([]);
  });

  it('should return the largest groups first, at most the limit', () => {
    const many = (message: string, n: number): FailedShipmentFacts[] =>
      Array.from({ length: n }, () => failure({ errorMessage: message }));
    const groups = groupFailedShipmentCauses(
      [...many('Address rejected', 2), ...many('Phone rejected', 4), ...many('Weight rejected', 3)],
      2,
    );

    expect(groups.map((g) => g.count)).toEqual([4, 3]);
  });
});

describe('isExactProviderCode', () => {
  it('should treat a classified code as exact and an unknown one as coarse', () => {
    expect(isExactProviderCode('api.http-503')).toBe(true);
    expect(isExactProviderCode('carrier-said-no')).toBe(false);
    expect(isExactProviderCode(null)).toBe(false);
  });
});

describe('normaliseErrorMessage', () => {
  it('should drop digits and punctuation and fold case', () => {
    expect(normaliseErrorMessage('Order #123: Phone INVALID!')).toBe('order phone invalid');
  });
});
