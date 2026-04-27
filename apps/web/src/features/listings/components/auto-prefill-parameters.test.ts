/**
 * Auto-Prefill Parameters — unit tests
 *
 * @module apps/web/src/features/listings/components
 */
import { describe, expect, it } from 'vitest';
import type { CategoryParameter } from '../api/listings.types';
import { autoPrefillParameters } from './auto-prefill-parameters';

function param(overrides: Partial<CategoryParameter>): CategoryParameter {
  return {
    id: 'x',
    name: 'X',
    type: 'string',
    required: false,
    restrictions: {},
    ...overrides,
  };
}

describe('autoPrefillParameters', () => {
  it('fills EAN parameter from variant.ean', () => {
    const out = autoPrefillParameters(
      [param({ id: 'p1', name: 'EAN (GTIN)', type: 'string' })],
      { ean: '5901234123457' },
    );
    expect(out.p1).toBe('5901234123457');
  });

  it('matches multiple EAN-class names case-insensitively', () => {
    const out = autoPrefillParameters(
      [
        param({ id: 'p1', name: 'GTIN', type: 'string' }),
        param({ id: 'p2', name: 'kod ean', type: 'string' }),
      ],
      { ean: '111' },
    );
    expect(out.p1).toBe('111');
    expect(out.p2).toBe('111');
  });

  it('does not fill EAN when variant.ean is empty', () => {
    const out = autoPrefillParameters([param({ id: 'p1', name: 'EAN' })], { ean: undefined });
    expect(out.p1).toBeUndefined();
  });

  it('defaults Stan to "Nowy" entry id when present in dictionary', () => {
    const out = autoPrefillParameters(
      [
        param({
          id: 'p1',
          name: 'Stan',
          type: 'dictionary',
          dictionary: [
            { id: 'p1_new', value: 'Nowy' },
            { id: 'p1_used', value: 'Używany' },
          ],
        }),
      ],
      {},
    );
    expect(out.p1).toBe('p1_new');
  });

  it('skips Stan default when no "new"-like entry exists', () => {
    const out = autoPrefillParameters(
      [
        param({
          id: 'p1',
          name: 'Stan',
          type: 'dictionary',
          dictionary: [{ id: 'p1_used', value: 'Używany' }],
        }),
      ],
      {},
    );
    expect(out.p1).toBeUndefined();
  });

  it('skips brand and producer-code (deferred to #412)', () => {
    const out = autoPrefillParameters(
      [
        param({ id: 'p1', name: 'Marka', type: 'dictionary' }),
        param({ id: 'p2', name: 'Kod producenta', type: 'string' }),
      ],
      { ean: '999' },
    );
    expect(out.p1).toBeUndefined();
    expect(out.p2).toBeUndefined();
  });
});
