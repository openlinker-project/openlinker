/**
 * amazonPackageReferenceId tests (#4178)
 *
 * @module libs/integrations/amazon/src/domain/policies/__tests__
 */
import { amazonPackageReferenceId } from '../amazon-package-reference.policy';

describe('amazonPackageReferenceId', () => {
  it('should give a positive number for an alphanumeric tracking number', () => {
    const reference = amazonPackageReferenceId('0000123456789U');
    expect(reference).toMatch(/^[1-9][0-9]*$/);
    expect(Number.isSafeInteger(Number(reference))).toBe(true);
  });

  it('should give the same reference for the same parcel and different ones for different parcels', () => {
    expect(amazonPackageReferenceId('DPD123ABC')).toBe(amazonPackageReferenceId(' DPD123ABC '));
    expect(amazonPackageReferenceId('DPD123ABC')).not.toBe(amazonPackageReferenceId('DPD123ABD'));
  });
});
