/**
 * Mirakl Inactivity Reason Policy: unit tests
 *
 * @module libs/integrations/mirakl/src/domain/policies
 */
import { mapMiraklInactivityReasons } from '../mirakl-inactivity-reason.policy';

describe('mapMiraklInactivityReasons', () => {
  it('should report a missing shipping rate as a shop-level problem', () => {
    expect(mapMiraklInactivityReasons(['NO_MIN_SHIPPING_RATE'], 'Empik')).toEqual([
      expect.objectContaining({ code: 'NO_MIN_SHIPPING_RATE', scope: 'account' }),
    ]);
  });

  it('should report zero stock as an offer problem', () => {
    expect(mapMiraklInactivityReasons(['ZERO_QUANTITY'], 'Empik')).toEqual([
      expect.objectContaining({ code: 'ZERO_QUANTITY', scope: 'offer' }),
    ]);
  });

  it('should pass an unknown reason through verbatim instead of dropping it', () => {
    const [problem] = mapMiraklInactivityReasons(['SOMETHING_NEW'], 'Empik');

    expect(problem).toMatchObject({ code: 'SOMETHING_NEW', scope: 'offer' });
    expect(problem.message).toContain('SOMETHING_NEW');
  });

  it('should map nothing for no reasons', () => {
    expect(mapMiraklInactivityReasons(undefined, 'Empik')).toEqual([]);
  });
});
