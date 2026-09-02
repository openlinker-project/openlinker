import {
  FulfillmentWorkStatusValues,
  isFulfillmentWorkStatus,
} from './fulfillment-work-status.types';

describe('FulfillmentWorkStatusValues', () => {
  it('should hold exactly the seven design-verbatim members in DESIGN §5.2 order', () => {
    expect(FulfillmentWorkStatusValues).toEqual([
      'open',
      'scheduled',
      'on_hold',
      'in_progress',
      'closed',
      'cancelled',
      'incomplete',
    ]);
  });

  it('should keep `closed` and `cancelled` as distinct members when ADR-054 forbids collapsing them', () => {
    // ADR-054: a force-close lands on `cancelled`, "never `closed`-as-completed".
    expect(FulfillmentWorkStatusValues).toContain('closed');
    expect(FulfillmentWorkStatusValues).toContain('cancelled');
    expect(new Set(FulfillmentWorkStatusValues).size).toBe(FulfillmentWorkStatusValues.length);
  });
});

describe('isFulfillmentWorkStatus', () => {
  it.each(FulfillmentWorkStatusValues)('should narrow %s when the value is a member', (value) => {
    expect(isFulfillmentWorkStatus(value)).toBe(true);
  });

  it.each([
    ['an unrecognised string', 'awaiting_wave'],
    ['a request-axis member', 'accepted'],
    ['an empty string', ''],
    ['null', null],
    ['undefined', undefined],
    ['a number', 1],
    ['an object', { status: 'open' }],
  ])('should reject %s', (_label, value) => {
    expect(isFulfillmentWorkStatus(value)).toBe(false);
  });
});
