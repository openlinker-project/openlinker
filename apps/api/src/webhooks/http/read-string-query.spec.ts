import { readStringQuery } from './read-string-query';

describe('readStringQuery', () => {
  it('should keep a plain string value', () => {
    expect(readStringQuery({ token: 'abc' })).toEqual({ token: 'abc' });
  });

  it('should keep only the FIRST value of a repeated key, so a second value cannot ride past a comparison', () => {
    expect(readStringQuery({ token: ['right', 'wrong'] })).toEqual({ token: 'right' });
  });

  it('should drop nested objects and non-string values', () => {
    expect(readStringQuery({ a: { b: 'c' }, n: 5, ok: 'yes' })).toEqual({ ok: 'yes' });
  });

  it('should return an empty object for an absent query', () => {
    expect(readStringQuery(undefined)).toEqual({});
  });
});
