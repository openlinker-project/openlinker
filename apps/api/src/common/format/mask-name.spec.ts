/**
 * Mask a person's name (#3425; extracted and shared by #3415)
 *
 * @module apps/api/src/common/format
 */
import { maskName } from './mask-name';

describe('maskName', () => {
  it('should reduce the first name to an initial and keep the surname', () => {
    expect(maskName('Anna Kowalska')).toBe('A. Kowalska');
    expect(maskName('Piotr Malinowski')).toBe('P. Malinowski');
  });

  it('should keep every part after the first when the name has three or more', () => {
    // A double-barrelled surname is a surname. Dropping the middle part would
    // mask MORE than the rule promises, and the point of the rule is that the
    // reader can still recognise who it is.
    expect(maskName('Anna Maria Kowalska')).toBe('A. Maria Kowalska');
  });

  it('should return a single-word name unmasked', () => {
    // No surname to keep and no first name to reduce. Masking further would
    // destroy the only identifying fact rather than reduce it — a company
    // name on the board, a single-token username on the bench.
    expect(maskName('Kowalska')).toBe('Kowalska');
    expect(maskName('admin')).toBe('admin');
  });

  it('should tolerate irregular whitespace', () => {
    expect(maskName('  Anna   Kowalska  ')).toBe('A. Kowalska');
  });

  it('should return an empty string unchanged rather than throwing', () => {
    // Callers decide whether an empty name is renderable; the rule itself has
    // nothing to mask and must not invent a placeholder.
    expect(maskName('')).toBe('');
    expect(maskName('   ')).toBe('   ');
  });
});
