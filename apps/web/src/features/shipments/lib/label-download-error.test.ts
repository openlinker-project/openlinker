/**
 * Unit tests for resolveLabelDownloadError (#2671).
 *
 * Covers every branch the mapper's own header comment documents, keyed to
 * the exact wire shapes `apps/api/src/shipping/http/shipment.controller.ts`
 * produces for each source exception.
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../shared/api/api-error';
import { resolveLabelDownloadError } from './label-download-error';

describe('resolveLabelDownloadError', () => {
  it('maps a network failure (status 0) to transient, with no server text echoed', () => {
    const error = ApiError.fromNetworkFailure(new Error('Failed to fetch'));
    const result = resolveLabelDownloadError(error);
    expect(result.retryable).toBe('transient');
    expect(result.tone).toBe('warning');
    expect(result.title).toBe('Couldn’t reach OpenLinker');
  });

  it('maps a client-side timeout (status 0) to transient', () => {
    const error = ApiError.fromTimeout('/v1/shipments/ol_shipment_1/label');
    const result = resolveLabelDownloadError(error);
    expect(result.retryable).toBe('transient');
  });

  it('maps 404 ShipmentNotFoundException to permanent, without guessing a cause', () => {
    const error = new ApiError('Shipment not found: ol_shipment_1', 404, {
      statusCode: 404,
      message: 'Shipment not found: ol_shipment_1',
      error: 'Not Found',
    });
    const result = resolveLabelDownloadError(error);
    expect(result.retryable).toBe('permanent');
    expect(result.tone).toBe('warning');
    expect(result.title).toBe('No shipment matches this id');
    expect(result.description).not.toMatch(/cancelled|replaced/i);
  });

  it('maps 422 LabelNotAvailableException ("not yet") to permanent, distinct copy from the unsupported case', () => {
    const error = new ApiError(
      'No label has been generated for shipment ol_shipment_1 yet - generate the label first',
      422,
      {
        statusCode: 422,
        message: 'No label has been generated for shipment ol_shipment_1 yet - generate the label first',
        error: 'Unprocessable Entity',
      },
    );
    const result = resolveLabelDownloadError(error);
    expect(result.retryable).toBe('permanent');
    expect(result.title).toBe('No label to download yet');
  });

  it('maps 422 LabelDocumentNotSupportedException ("never") to permanent, distinct copy from the not-yet case', () => {
    const error = new ApiError(
      'Cannot fetch label for shipment ol_shipment_1: connection conn-1 does not support returning label documents',
      422,
      {
        statusCode: 422,
        message:
          'Cannot fetch label for shipment ol_shipment_1: connection conn-1 does not support returning label documents',
        error: 'Unprocessable Entity',
      },
    );
    const result = resolveLabelDownloadError(error);
    expect(result.retryable).toBe('permanent');
    expect(result.title).toBe('This carrier doesn’t provide a downloadable label');
  });

  it('maps 502 ShippingProviderRejectionException to unknown, echoing the server message + providerCode verbatim', () => {
    const error = new ApiError('Waybill expired', 502, {
      message: 'Waybill expired for this shipment',
      providerCode: 'DPD.WAYBILL_EXPIRED',
      details: undefined,
    });
    const result = resolveLabelDownloadError(error);
    expect(result.retryable).toBe('unknown');
    expect(result.tone).toBe('error');
    expect(result.title).toBe('The carrier rejected the request');
    expect(result.description).toBe('Waybill expired for this shipment (ref: DPD.WAYBILL_EXPIRED)');
  });

  it('never re-redacts a 502 rejection already redacted server-side for a viewer', () => {
    // #1826: a viewer session receives `message: REDACTED_ERROR_MESSAGE` from
    // the API itself. The mapper must echo it unchanged, not substitute its
    // own copy - re-redacting would be the FE inventing a second policy.
    const error = new ApiError('Details hidden for this role.', 502, {
      message: 'Details hidden for this role.',
      providerCode: 'DPD.WAYBILL_EXPIRED',
    });
    const result = resolveLabelDownloadError(error);
    expect(result.description).toBe('Details hidden for this role. (ref: DPD.WAYBILL_EXPIRED)');
  });

  it('handles a 502 rejection with a null providerCode without appending a bogus ref', () => {
    const error = new ApiError('Rejected', 502, { message: 'Rejected', providerCode: null });
    const result = resolveLabelDownloadError(error);
    expect(result.description).toBe('Rejected');
  });

  it('maps 502 ShippingProviderAuthException (no providerCode key) to auth, needing an admin', () => {
    const error = new ApiError('Carrier credentials rejected', 502, {
      statusCode: 502,
      message: 'Carrier credentials rejected',
      error: 'Bad Gateway',
    });
    const result = resolveLabelDownloadError(error);
    expect(result.retryable).toBe('auth');
    expect(result.tone).toBe('error');
    expect(result.title).toBe('Our stored carrier credentials were rejected');
  });

  it('maps an unclassified 500 to a fixed fallback, never echoing the raw backend message', () => {
    const error = new ApiError('Unexpected token in JSON at position 0', 500, {
      statusCode: 500,
      message: 'Unexpected token in JSON at position 0',
      error: 'Internal Server Error',
    });
    const result = resolveLabelDownloadError(error);
    expect(result.retryable).toBe('unknown');
    expect(result.description).not.toContain('Unexpected token');
  });

  it('falls back to the unknown-fixed copy for a non-ApiError throw', () => {
    const result = resolveLabelDownloadError(new Error('boom'));
    expect(result.retryable).toBe('unknown');
    expect(result.title).toBe('Something went wrong');
  });
});
