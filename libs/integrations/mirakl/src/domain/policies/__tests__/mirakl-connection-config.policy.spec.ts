/**
 * Mirakl Connection Config Policy: unit tests
 *
 * @module libs/integrations/mirakl/src/domain/policies
 */
import { empikOperatorProfile } from '../../../operators/empik.profile';
import {
  isMiraklEnvironment,
  readMiraklShopId,
  resolveMiraklBaseUrl,
} from '../mirakl-connection-config.policy';

describe('resolveMiraklBaseUrl', () => {
  it('should return the staging host when the environment is staging', () => {
    expect(resolveMiraklBaseUrl(empikOperatorProfile, 'staging')).toBe(
      'https://stg1.marketplace.empik.com',
    );
  });

  it('should return the production host when the environment is absent', () => {
    expect(resolveMiraklBaseUrl(empikOperatorProfile, undefined)).toBe(
      'https://marketplace.empik.com',
    );
  });

  it('should return the production host when the environment is unrecognised', () => {
    expect(resolveMiraklBaseUrl(empikOperatorProfile, 'sandbox')).toBe(
      'https://marketplace.empik.com',
    );
  });
});

describe('isMiraklEnvironment', () => {
  it('should accept the two known environments only', () => {
    expect(isMiraklEnvironment('production')).toBe(true);
    expect(isMiraklEnvironment('staging')).toBe(true);
    expect(isMiraklEnvironment('sandbox')).toBe(false);
    expect(isMiraklEnvironment(1)).toBe(false);
  });
});

describe('readMiraklShopId', () => {
  it.each([undefined, null, ''])('should report absent when the value is %p', (value) => {
    expect(readMiraklShopId(value)).toEqual({ kind: 'absent' });
  });

  it('should accept a positive integer number', () => {
    expect(readMiraklShopId(6881)).toEqual({ kind: 'valid', shopId: '6881' });
  });

  it('should accept a digit string and trim it', () => {
    expect(readMiraklShopId(' 6881 ')).toEqual({ kind: 'valid', shopId: '6881' });
  });

  it.each([0, -1, 1.5, '0', '12a', '6881&x=1', true, {}])(
    'should report invalid when the value is %p',
    (value) => {
      expect(readMiraklShopId(value)).toEqual({ kind: 'invalid' });
    },
  );
});
