import {
  isZeroValueLineSupport,
  readZeroValueLineSupport,
} from './zero-value-line.capability';

describe('zero-value-line capability', () => {
  it('should narrow an adapter that declares the method', () => {
    expect(isZeroValueLineSupport({ acceptsZeroValueLine: () => true })).toBe(true);
  });

  it('should tolerate an adapter without the method', () => {
    expect(isZeroValueLineSupport({})).toBe(false);
    expect(isZeroValueLineSupport(null)).toBe(false);
    expect(readZeroValueLineSupport({})).toBeUndefined();
  });

  it('should read the declared answer as a plain boolean', () => {
    expect(readZeroValueLineSupport({ acceptsZeroValueLine: () => true })).toBe(true);
    expect(readZeroValueLineSupport({ acceptsZeroValueLine: () => false })).toBe(false);
  });

  it('should treat a throwing or non-boolean declaration as undeclared', () => {
    expect(
      readZeroValueLineSupport({
        acceptsZeroValueLine: () => {
          throw new Error('boom');
        },
      }),
    ).toBeUndefined();
    expect(
      readZeroValueLineSupport({ acceptsZeroValueLine: () => 'yes' as unknown as boolean }),
    ).toBeUndefined();
  });
});
