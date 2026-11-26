/**
 * Mirakl Order State Policy: unit tests
 *
 * @module libs/integrations/mirakl/src/domain/policies
 */
import { isDispatchedOrderState } from '../mirakl-order-state.policy';

describe('isDispatchedOrderState', () => {
  it.each(['SHIPPED', 'TO_COLLECT', 'RECEIVED', 'CLOSED'])(
    'should read %s as dispatched',
    (state) => {
      expect(isDispatchedOrderState(state)).toBe(true);
    }
  );

  it.each(['SHIPPING', 'WAITING_DEBIT', 'CANCELED', 'REFUSED'])(
    'should read %s as not dispatched',
    (state) => {
      expect(isDispatchedOrderState(state)).toBe(false);
    }
  );

  it('should read an unknown or missing state as unknown', () => {
    expect(isDispatchedOrderState('LOST_IN_SPACE')).toBeNull();
    expect(isDispatchedOrderState(undefined)).toBeNull();
  });
});
