import {
  checkFulfillmentWorkLineCapacity,
  readFulfillmentWorkLineRemainingQuantity,
  type FulfillmentWorkLine,
} from './fulfillment-work.types';

const line = (overrides: Partial<FulfillmentWorkLine> = {}): FulfillmentWorkLine => ({
  id: 'line-1',
  orderLineId: 'ol-line-1',
  productVariantId: 'ol_variant_1',
  totalQuantity: 5,
  fulfilledQuantity: 0,
  cancelledQuantity: 0,
  ...overrides,
});

describe('readFulfillmentWorkLineRemainingQuantity', () => {
  it('should report the whole quantity when nothing has been accounted for', () => {
    expect(readFulfillmentWorkLineRemainingQuantity(line())).toBe(5);
  });

  it('should express a partial fulfilment that no status axis could carry', () => {
    // "3 of 5 shipped" is not a status (DESIGN §5.2).
    expect(readFulfillmentWorkLineRemainingQuantity(line({ fulfilledQuantity: 3 }))).toBe(2);
  });

  it('should count cancelled units as accounted for', () => {
    expect(
      readFulfillmentWorkLineRemainingQuantity(line({ fulfilledQuantity: 3, cancelledQuantity: 2 }))
    ).toBe(0);
  });
});

describe('checkFulfillmentWorkLineCapacity', () => {
  it('should accept a line whose counters sum below the total', () => {
    expect(checkFulfillmentWorkLineCapacity(line({ fulfilledQuantity: 1 }))).toBe(true);
  });

  it('should accept a line whose counters sum exactly to the total', () => {
    expect(
      checkFulfillmentWorkLineCapacity(line({ fulfilledQuantity: 3, cancelledQuantity: 2 }))
    ).toBe(true);
  });

  it('should reject a line whose counters exceed the total', () => {
    // #2392 mirrors this as the DB CHECK; the two must move together.
    expect(
      checkFulfillmentWorkLineCapacity(line({ fulfilledQuantity: 4, cancelledQuantity: 2 }))
    ).toBe(false);
  });

  // The three cases below are why #2392 widened this function. Each one
  // formerly PASSED — a negative counter leaves `remaining` large and positive,
  // so the old `remaining >= 0` test waved it through — while
  // `CHK_fulfillment_work_lines_capacity` rejects it. One rule under one name
  // means the function and the constraint must agree on every input, not only
  // on the ones the happy path produces.
  it('should reject a negative fulfilled quantity even though remaining stays positive', () => {
    const negative = line({ fulfilledQuantity: -1 });
    expect(readFulfillmentWorkLineRemainingQuantity(negative)).toBe(6);
    expect(checkFulfillmentWorkLineCapacity(negative)).toBe(false);
  });

  it('should reject a negative cancelled quantity', () => {
    expect(checkFulfillmentWorkLineCapacity(line({ cancelledQuantity: -2 }))).toBe(false);
  });

  it('should reject a negative total quantity', () => {
    expect(checkFulfillmentWorkLineCapacity(line({ totalQuantity: -1 }))).toBe(false);
  });

  it('should accept a fully zero line', () => {
    // A work object may legitimately carry a zero-quantity line; zero is not negative.
    expect(checkFulfillmentWorkLineCapacity(line({ totalQuantity: 0 }))).toBe(true);
  });
});
