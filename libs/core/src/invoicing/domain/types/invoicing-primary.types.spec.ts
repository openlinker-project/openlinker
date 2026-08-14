/**
 * Primary invoicing-connection selection unit tests (#2047).
 *
 * @module libs/core/src/invoicing/domain/types
 */
import {
  parseIsPrimaryInvoicing,
  selectPrimaryInvoicingConnection,
} from './invoicing-primary.types';

describe('parseIsPrimaryInvoicing', () => {
  it('should read a real boolean true as primary', () => {
    expect(parseIsPrimaryInvoicing(true)).toBe(true);
  });

  it('should read the string "true" as primary (hand-edited JSON config)', () => {
    expect(parseIsPrimaryInvoicing('true')).toBe(true);
  });

  it.each([[undefined], [null], [false], ['yes'], [1], [{}], [[]]])(
    'should default an untrusted value (%p) to NOT primary',
    (value) => {
      expect(parseIsPrimaryInvoicing(value)).toBe(false);
    },
  );
});

describe('selectPrimaryInvoicingConnection', () => {
  it('should report none when there are no candidates', () => {
    expect(selectPrimaryInvoicingConnection([])).toEqual({ kind: 'none' });
  });

  it('should select the lone candidate regardless of its primary flag', () => {
    expect(selectPrimaryInvoicingConnection([{ id: 'a', isPrimary: false }])).toEqual({
      kind: 'selected',
      connectionId: 'a',
    });
  });

  it('should select the single primary when several candidates exist', () => {
    expect(
      selectPrimaryInvoicingConnection([
        { id: 'a', isPrimary: false },
        { id: 'b', isPrimary: true },
        { id: 'c', isPrimary: false },
      ]),
    ).toEqual({ kind: 'selected', connectionId: 'b' });
  });

  it('should report ambiguity naming every candidate when several exist and none is primary', () => {
    expect(
      selectPrimaryInvoicingConnection([
        { id: 'a', isPrimary: false },
        { id: 'b', isPrimary: false },
      ]),
    ).toEqual({ kind: 'ambiguous', reason: 'no-primary', candidateIds: ['a', 'b'] });
  });

  it('should report ambiguity naming only the primaries when more than one is primary', () => {
    expect(
      selectPrimaryInvoicingConnection([
        { id: 'a', isPrimary: true },
        { id: 'b', isPrimary: true },
        { id: 'c', isPrimary: false },
      ]),
    ).toEqual({ kind: 'ambiguous', reason: 'multiple-primaries', candidateIds: ['a', 'b'] });
  });
});
