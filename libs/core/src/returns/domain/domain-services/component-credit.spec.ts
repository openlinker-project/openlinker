import { summarizeComponentCredits } from './return-correction-matching.domain-service';

const act = (over: Record<string, unknown> = {}) => ({
  returnLineId: 'l1',
  componentGroup: 'g1',
  componentVariantId: 'v-a',
  componentShareGross: 40,
  quantity: 1,
  confirmed: true,
  ...over,
});

describe('summarizeComponentCredits', () => {
  it('should credit the sum of the shares of a confirmed partial group', () => {
    const credits = summarizeComponentCredits([
      act(),
      act({ componentVariantId: 'v-b', componentShareGross: 10.5 }),
    ]);
    expect(credits.get('l1')).toEqual({
      units: 1,
      amountGross: 50.5,
      variantIds: ['v-a', 'v-b'],
      components: [
        { variantId: 'v-a', bundleUnits: 1 },
        { variantId: 'v-b', bundleUnits: 1 },
      ],
    });
  });

  it('should ignore a group with a refused component', () => {
    expect(summarizeComponentCredits([act(), act({ confirmed: false, componentVariantId: 'v-b' })]).size).toBe(0);
  });

  it('should ignore a whole-set group (no price share)', () => {
    expect(summarizeComponentCredits([act({ componentShareGross: null })]).size).toBe(0);
  });
});
