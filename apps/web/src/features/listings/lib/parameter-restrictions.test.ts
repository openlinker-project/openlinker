/**
 * Parameter-restriction mirror tests (#2243)
 *
 * The mirror is a copy of a CORE checker, so these tests do two jobs: they cover
 * the client-side rules the Review step depends on, and they pin the behaviours
 * that must not diverge from the backend half (`check-parameter-restrictions.spec.ts`
 * covers the same bounds there). The code LIST is guarded separately by
 * `scripts/check-parameter-restriction-mirror.mjs`; behaviour parity is here.
 *
 * @module apps/web/src/features/listings/lib
 */
import { describe, expect, it } from 'vitest';

import {
  ParameterRestrictionIssueCodeValues,
  checkParameterRestrictions,
  checkRowParameterRestrictions,
  type RestrictedParameter,
} from './parameter-restrictions';

function param(overrides: Partial<RestrictedParameter> = {}): RestrictedParameter {
  return {
    id: '250792',
    name: 'Kod taryfy celnej',
    type: 'string',
    restrictions: {},
    ...overrides,
  };
}

describe('checkParameterRestrictions (FE mirror)', () => {
  it('reports nothing without a value, and nothing without a declared bound', () => {
    expect(checkParameterRestrictions(param({ restrictions: { minLength: 8 } }), {})).toEqual([]);
    expect(checkParameterRestrictions(param(), { texts: ['250792'] })).toEqual([]);
  });

  it('treats an empty string as no value at all', () => {
    expect(
      checkParameterRestrictions(param({ restrictions: { minLength: 8 } }), { texts: [''] }),
    ).toEqual([]);
  });

  it('reports a string shorter than the declared minimum', () => {
    const issues = checkParameterRestrictions(param({ restrictions: { minLength: 8 } }), {
      texts: ['250792'],
    });
    expect(issues.map((i) => i.code)).toEqual(['VALUE_TOO_SHORT']);
    expect(issues[0].parameterName).toBe('Kod taryfy celnej');
    expect(issues[0].message).toContain('at least 8');
  });

  it('accepts both edges of a declared length range', () => {
    const p = param({ restrictions: { minLength: 8, maxLength: 10 } });
    expect(checkParameterRestrictions(p, { texts: ['25079200'] })).toEqual([]);
    expect(checkParameterRestrictions(p, { texts: ['2507920012'] })).toEqual([]);
  });

  it('reports numeric bounds and precision on the declared type', () => {
    const blade = param({ id: 'b', name: 'Długość ostrza', type: 'float', restrictions: { min: 5, max: 40, precision: 1 } });
    expect(checkParameterRestrictions(blade, { texts: ['0.5'] }).map((i) => i.code)).toEqual([
      'VALUE_BELOW_MIN',
    ]);
    expect(checkParameterRestrictions(blade, { texts: ['41'] }).map((i) => i.code)).toEqual([
      'VALUE_ABOVE_MAX',
    ]);
    expect(checkParameterRestrictions(blade, { texts: ['17.25'] }).map((i) => i.code)).toEqual([
      'PRECISION_EXCEEDED',
    ]);
    expect(checkParameterRestrictions(blade, { texts: ['17.2'] })).toEqual([]);
  });

  it('reports a non-numeric value for a numeric parameter', () => {
    const blade = param({ type: 'integer' });
    expect(checkParameterRestrictions(blade, { texts: ['ten'] }).map((i) => i.code)).toEqual([
      'NOT_NUMERIC',
    ]);
  });

  it('reports a dictionary value outside the enumerated set, by id or by text', () => {
    const kolor = param({
      id: '127590',
      name: 'Kolor',
      type: 'dictionary',
      dictionary: [
        { id: '1', value: 'Beżowy' },
        { id: '2', value: 'Czarny' },
      ],
    });
    expect(checkParameterRestrictions(kolor, { values: ['99'] }).map((i) => i.code)).toEqual([
      'VALUE_NOT_IN_DICTIONARY',
    ]);
    expect(checkParameterRestrictions(kolor, { texts: ['Cappuccino'] }).map((i) => i.code)).toEqual([
      'VALUE_NOT_IN_DICTIONARY',
    ]);
    expect(checkParameterRestrictions(kolor, { values: ['2'] })).toEqual([]);
    expect(checkParameterRestrictions(kolor, { texts: ['Czarny'] })).toEqual([]);
  });

  it('says nothing about a dictionary that accepts custom values', () => {
    const kolor = param({
      type: 'dictionary',
      restrictions: { customValuesEnabled: true },
      dictionary: [{ id: '1', value: 'Beżowy' }],
    });
    expect(checkParameterRestrictions(kolor, { texts: ['Cappuccino'] })).toEqual([]);
  });

  it('reports more values than the parameter accepts', () => {
    const issues = checkParameterRestrictions(
      param({ restrictions: { allowedNumberOfValues: 1 } }),
      { texts: ['one-value', 'two-value'] },
    );
    expect(issues.map((i) => i.code)).toContain('TOO_MANY_VALUES');
  });

  it('keeps the code vocabulary in the order the backend declares it', () => {
    expect([...ParameterRestrictionIssueCodeValues]).toEqual([
      'VALUE_TOO_SHORT',
      'VALUE_TOO_LONG',
      'VALUE_BELOW_MIN',
      'VALUE_ABOVE_MAX',
      'PRECISION_EXCEEDED',
      'NOT_NUMERIC',
      'VALUE_NOT_IN_DICTIONARY',
      'TOO_MANY_VALUES',
    ]);
  });
});

describe('checkRowParameterRestrictions', () => {
  const schema: RestrictedParameter[] = [
    param({ restrictions: { minLength: 8 } }),
    param({ id: 'b', name: 'Długość ostrza', type: 'float', restrictions: { min: 5 } }),
  ];

  it('checks every supplied parameter the schema describes', () => {
    const issues = checkRowParameterRestrictions(schema, [
      { id: '250792', values: ['250792'] },
      { id: 'b', values: ['0.5'] },
    ]);
    expect(issues.map((i) => i.code)).toEqual(['VALUE_TOO_SHORT', 'VALUE_BELOW_MIN']);
  });

  it('skips a supplied parameter the schema does not describe', () => {
    // An unknown id is the adapter's business; inventing a rule for it is
    // exactly what this module refuses to do.
    expect(checkRowParameterRestrictions(schema, [{ id: 'unknown', values: ['x'] }])).toEqual([]);
  });

  it('checks both ends of a range value against the same bounds', () => {
    const issues = checkRowParameterRestrictions(schema, [
      { id: 'b', rangeValue: { from: '1', to: '2' } },
    ]);
    expect(issues.map((i) => i.code)).toEqual(['VALUE_BELOW_MIN', 'VALUE_BELOW_MIN']);
  });

  it('is inert with no schema or no supplied values', () => {
    expect(checkRowParameterRestrictions([], [{ id: '250792', values: ['250792'] }])).toEqual([]);
    expect(checkRowParameterRestrictions(schema, [])).toEqual([]);
  });
});
