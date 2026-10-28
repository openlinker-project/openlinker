/**
 * Fiscal Provider Failure Details - spec (#3843)
 *
 * The reader is the one gate an adapter's identifiers pass before they are
 * persisted and shown: shaped values survive, free text does not.
 */
import { readFiscalProviderFailureDetails } from './fiscal-provider-failure-details.types';

describe('readFiscalProviderFailureDetails', () => {
  it('should read the identifiers an adapter declared', () => {
    const error = Object.assign(new Error('internal'), {
      providerErrorCode: '83',
      providerDeviceErrorCode: 16,
      providerDocumentId: '70a7fd05-3c1e-4b8a-9f2d-61e0c4a7b93e',
      providerErrorHint: 'Check the printer.',
    });

    expect(readFiscalProviderFailureDetails(error)).toEqual({
      errorCode: '83',
      deviceErrorCode: '16',
      documentId: '70a7fd05-3c1e-4b8a-9f2d-61e0c4a7b93e',
      hint: 'Check the printer.',
    });
  });

  it('should return null when the adapter declared nothing', () => {
    expect(readFiscalProviderFailureDetails(new Error('plain'))).toBeNull();
    expect(readFiscalProviderFailureDetails('a string')).toBeNull();
    expect(readFiscalProviderFailureDetails(null)).toBeNull();
  });

  it('should drop a code or document id that is free text rather than an identifier', () => {
    const error = {
      providerErrorCode: '83 printer error: Secret Product Name',
      providerDeviceErrorCode: 'Kod bledu drukarki: 16',
      providerDocumentId: 'document for Jan Kowalski',
    };

    expect(readFiscalProviderFailureDetails(error)).toBeNull();
  });

  it('should bound the hint to the failure-reason length', () => {
    const details = readFiscalProviderFailureDetails({ providerErrorHint: 'x'.repeat(500) });

    expect(details?.hint).toHaveLength(200);
  });
});
