/**
 * RoutingRuleInputDto - parcel profile validation (#3651).
 *
 * @module apps/api/src/mappings/http/dto
 */
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PARCEL_PROFILE_BOUNDS } from '@openlinker/core/mappings';

import { RoutingRuleInputDto } from './routing-rule-input.dto';

const base = {
  sourceDeliveryMethodId: 'm1',
  processorKind: 'source_brokered',
  processorConnectionId: 'c1',
};

async function errorsFor(payload: Record<string, unknown>): Promise<number> {
  return (await validate(plainToInstance(RoutingRuleInputDto, payload))).length;
}

describe('RoutingRuleInputDto parcelProfile', () => {
  it('should accept a rule without a profile', async () => {
    expect(await errorsFor(base)).toBe(0);
  });

  it('should accept a null profile and a fully populated one', async () => {
    expect(await errorsFor({ ...base, parcelProfile: null })).toBe(0);
    expect(
      await errorsFor({
        ...base,
        parcelProfile: { parcelTemplate: 'large', lengthMm: 300, widthMm: 200, heightMm: 100, defaultWeightGrams: 250 },
      }),
    ).toBe(0);
  });

  it.each([
    ['zero', 0],
    ['negative', -5],
    ['non-integer', 1.5],
    ['above the maximum', 5001],
  ])('should reject a %s dimension', async (_label, value) => {
    expect(await errorsFor({ ...base, parcelProfile: { lengthMm: value } })).toBeGreaterThan(0);
  });

  it('should reject a non-positive default weight', async () => {
    expect(await errorsFor({ ...base, parcelProfile: { defaultWeightGrams: 0 } })).toBeGreaterThan(0);
  });

  it('should accept a profile when every value sits exactly on a bound', async () => {
    const { dimensionMmMin, dimensionMmMax, defaultWeightGramsMin, defaultWeightGramsMax } =
      PARCEL_PROFILE_BOUNDS;
    for (const profile of [
      {
        lengthMm: dimensionMmMin,
        widthMm: dimensionMmMin,
        heightMm: dimensionMmMin,
        defaultWeightGrams: defaultWeightGramsMin,
      },
      {
        lengthMm: dimensionMmMax,
        widthMm: dimensionMmMax,
        heightMm: dimensionMmMax,
        defaultWeightGrams: defaultWeightGramsMax,
      },
    ]) {
      expect(await errorsFor({ ...base, parcelProfile: profile })).toBe(0);
    }
    expect(
      await errorsFor({ ...base, parcelProfile: { defaultWeightGrams: defaultWeightGramsMax + 1 } })
    ).toBeGreaterThan(0);
  });
});
