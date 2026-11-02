import { describe, expect, it } from 'vitest';
import { parseContentDispositionFilename } from './content-disposition';

describe('parseContentDispositionFilename', () => {
  it('should read a quoted filename when the header carries one', () => {
    expect(parseContentDispositionFilename('attachment; filename="a_b.csv"')).toBe('a_b.csv');
  });

  it('should prefer the extended filename when both forms are present', () => {
    expect(
      parseContentDispositionFilename("attachment; filename=\"x.csv\"; filename*=UTF-8''z%C5%82.csv")
    ).toBe('zł.csv');
  });

  it('should return null when the header is absent or names no file', () => {
    expect(parseContentDispositionFilename(null)).toBeNull();
    expect(parseContentDispositionFilename('attachment')).toBeNull();
  });
});
