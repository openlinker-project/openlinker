/**
 * check-parameter-restrictions unit tests (#2243)
 *
 * Both sides of every declared bound, plus the two cases that decide whether the
 * checker can be trusted at all: a bound the destination did NOT declare must
 * produce nothing, and a value inside the bound must produce nothing.
 */

import { checkParameterRestrictions } from '../check-parameter-restrictions';
import type { CategoryParameter } from '../../../domain/types/category-parameter.types';

function param(overrides: Partial<CategoryParameter> = {}): CategoryParameter {
  return {
    id: '250792',
    name: 'Kod taryfy celnej',
    type: 'string',
    required: false,
    restrictions: {},
    section: 'product',
    ...overrides,
  };
}

describe('checkParameterRestrictions', () => {
  it('should report nothing when no value is supplied', () => {
    const issues = checkParameterRestrictions(param({ restrictions: { minLength: 8 } }), {});
    expect(issues).toEqual([]);
  });

  it('should report nothing when the destination declared no bounds', () => {
    const issues = checkParameterRestrictions(param(), { texts: ['250792'] });
    expect(issues).toEqual([]);
  });

  describe('string length', () => {
    it('should report a value shorter than the declared minLength', () => {
      const issues = checkParameterRestrictions(param({ restrictions: { minLength: 8 } }), {
        texts: ['250792'],
      });
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        code: 'VALUE_TOO_SHORT',
        severity: 'block',
        parameterId: '250792',
        parameterName: 'Kod taryfy celnej',
      });
      expect(issues[0].message).toContain('at least 8');
    });

    it('should accept a value exactly at the declared minLength', () => {
      expect(
        checkParameterRestrictions(param({ restrictions: { minLength: 8 } }), {
          texts: ['25079200'],
        }),
      ).toEqual([]);
    });

    it('should report a value longer than the declared maxLength', () => {
      const issues = checkParameterRestrictions(
        param({ restrictions: { minLength: 8, maxLength: 10 } }),
        { texts: ['250792001234'] },
      );
      expect(issues.map((i) => i.code)).toEqual(['VALUE_TOO_LONG']);
    });

    it('should accept a value exactly at the declared maxLength', () => {
      expect(
        checkParameterRestrictions(param({ restrictions: { maxLength: 10 } }), {
          texts: ['2507920012'],
        }),
      ).toEqual([]);
    });
  });

  describe('numeric bounds', () => {
    const blade = (restrictions: CategoryParameter['restrictions']): CategoryParameter =>
      param({ id: '219851', name: 'Długość ostrza', type: 'float', restrictions });

    it('should report a value below the declared minimum', () => {
      const issues = checkParameterRestrictions(blade({ min: 5, max: 40 }), { texts: ['0.5'] });
      expect(issues.map((i) => i.code)).toEqual(['VALUE_BELOW_MIN']);
    });

    it('should report a value above the declared maximum', () => {
      const issues = checkParameterRestrictions(blade({ min: 5, max: 40 }), { texts: ['41'] });
      expect(issues.map((i) => i.code)).toEqual(['VALUE_ABOVE_MAX']);
    });

    it('should accept both edges of the declared range', () => {
      expect(checkParameterRestrictions(blade({ min: 5, max: 40 }), { texts: ['5'] })).toEqual([]);
      expect(checkParameterRestrictions(blade({ min: 5, max: 40 }), { texts: ['40'] })).toEqual([]);
    });

    it('should report a non-numeric value for a numeric parameter', () => {
      const issues = checkParameterRestrictions(blade({ min: 5 }), { texts: ['about ten'] });
      expect(issues.map((i) => i.code)).toEqual(['NOT_NUMERIC']);
    });

    it('should report a fractional value for an integer parameter', () => {
      const issues = checkParameterRestrictions(
        param({ id: 'p', name: 'Liczba sztuk', type: 'integer', restrictions: {} }),
        { texts: ['2.5'] },
      );
      expect(issues.map((i) => i.code)).toEqual(['NOT_NUMERIC']);
    });

    it('should report more decimals than the declared precision', () => {
      const issues = checkParameterRestrictions(blade({ precision: 1 }), { texts: ['17.25'] });
      expect(issues.map((i) => i.code)).toEqual(['PRECISION_EXCEEDED']);
    });

    it('should accept exactly the declared precision, counted on the text', () => {
      // 17.50 is 2 declared decimals even though Number() would say 17.5.
      expect(checkParameterRestrictions(blade({ precision: 2 }), { texts: ['17.50'] })).toEqual([]);
    });
  });

  describe('dictionary', () => {
    const kolor = (restrictions: CategoryParameter['restrictions'] = {}): CategoryParameter =>
      param({
        id: '127590',
        name: 'Kolor',
        type: 'dictionary',
        restrictions,
        dictionary: [
          { id: '1', value: 'Beżowy' },
          { id: '2', value: 'Czarny' },
        ],
      });

    it('should report a value id outside the dictionary', () => {
      const issues = checkParameterRestrictions(kolor(), { values: ['99'] });
      expect(issues.map((i) => i.code)).toEqual(['VALUE_NOT_IN_DICTIONARY']);
    });

    it('should accept a value id inside the dictionary', () => {
      expect(checkParameterRestrictions(kolor(), { values: ['1'] })).toEqual([]);
    });

    it('should report free text outside the dictionary - the shape a mapping rule produces', () => {
      const issues = checkParameterRestrictions(kolor(), { texts: ['Cappuccino'] });
      expect(issues.map((i) => i.code)).toEqual(['VALUE_NOT_IN_DICTIONARY']);
    });

    it('should accept free text that matches a dictionary entry value', () => {
      expect(checkParameterRestrictions(kolor(), { texts: ['Czarny'] })).toEqual([]);
    });

    it('should report nothing when the parameter accepts custom values', () => {
      expect(
        checkParameterRestrictions(kolor({ customValuesEnabled: true }), { texts: ['Cappuccino'] }),
      ).toEqual([]);
    });

    it('should report nothing when the destination enumerated no entries', () => {
      const issues = checkParameterRestrictions(
        param({ id: 'x', name: 'Kolor', type: 'dictionary', restrictions: {} }),
        { values: ['whatever'] },
      );
      expect(issues).toEqual([]);
    });
  });

  describe('value count', () => {
    it('should report more values than the declared maximum', () => {
      const issues = checkParameterRestrictions(
        param({ restrictions: { allowedNumberOfValues: 1 } }),
        { texts: ['a-value', 'another-value'] },
      );
      expect(issues.map((i) => i.code)).toContain('TOO_MANY_VALUES');
    });

    it('should accept exactly the declared number of values', () => {
      expect(
        checkParameterRestrictions(
          param({ type: 'dictionary', restrictions: { allowedNumberOfValues: 2 }, dictionary: [
            { id: '1', value: 'a' },
            { id: '2', value: 'b' },
          ] }),
          { values: ['1', '2'] },
        ),
      ).toEqual([]);
    });
  });

  it('should report every violated bound, not just the first', () => {
    const issues = checkParameterRestrictions(
      param({ type: 'float', restrictions: { min: 5, precision: 1, allowedNumberOfValues: 1 } }),
      { texts: ['0.55', '0.66'] },
    );
    expect(issues.map((i) => i.code).sort()).toEqual([
      'PRECISION_EXCEEDED',
      'PRECISION_EXCEEDED',
      'TOO_MANY_VALUES',
      'VALUE_BELOW_MIN',
      'VALUE_BELOW_MIN',
    ]);
  });
});
