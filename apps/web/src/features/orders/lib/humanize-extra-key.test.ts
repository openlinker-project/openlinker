import { describe, expect, it } from 'vitest';

import { humanizeExtraKey } from './humanize-extra-key';

describe('humanizeExtraKey', () => {
  it('should split camelCase into sentence case when the key has word boundaries', () => {
    expect(humanizeExtraKey('processingMode')).toBe('Processing mode');
    expect(humanizeExtraKey('fiscalDocumentId')).toBe('Fiscal document id');
  });

  it('should split snake and kebab case when the key uses separators', () => {
    expect(humanizeExtraKey('fiscal_document_number')).toBe('Fiscal document number');
    expect(humanizeExtraKey('transaction-token')).toBe('Transaction token');
    expect(humanizeExtraKey('FISCAL_DOCUMENT_ID')).toBe('Fiscal document id');
  });

  it('should keep an acronym intact when it precedes a capitalised word', () => {
    expect(humanizeExtraKey('POSId')).toBe('POS id');
    expect(humanizeExtraKey('merchantVATNumber')).toBe('Merchant VAT number');
  });

  it('should return the key unchanged when it cannot be split', () => {
    expect(humanizeExtraKey('POSID')).toBe('POSID');
    expect(humanizeExtraKey('FISCALDOCUMENTID')).toBe('FISCALDOCUMENTID');
    expect(humanizeExtraKey('printed')).toBe('Printed');
  });

  it('should return the key unchanged when it is blank', () => {
    expect(humanizeExtraKey('')).toBe('');
  });
});
