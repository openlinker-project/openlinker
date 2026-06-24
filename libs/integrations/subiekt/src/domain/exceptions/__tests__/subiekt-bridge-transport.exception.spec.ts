/**
 * SubiektBridgeTransportError — unit tests (#1200)
 *
 * Pins the neutral `failureMode` discriminator the core `InvoiceService` reads
 * STRUCTURALLY off this error. The transport retryability axis maps 1:1 onto the
 * neutral fiscal mode: a PROVEN-safe transport failure (request never left the
 * host) means no document was created (`rejected`, safe to re-attempt); an
 * indeterminate one means a document MAY exist (`in-doubt`, unsafe).
 *
 * @module libs/integrations/subiekt/src/domain/exceptions
 */
import { SubiektBridgeTransportError } from '../subiekt-bridge-transport.exception';

describe('SubiektBridgeTransportError (#1200 failureMode)', () => {
  it("maps retryability 'safe' -> failureMode 'rejected' (no document created)", () => {
    const error = new SubiektBridgeTransportError('connect refused', 'safe');
    expect(error.failureMode).toBe('rejected');
    expect(error.retryable).toBe(true);
  });

  it("maps retryability 'indeterminate' -> failureMode 'in-doubt' (document may exist)", () => {
    const error = new SubiektBridgeTransportError('timeout', 'indeterminate');
    expect(error.failureMode).toBe('in-doubt');
    expect(error.retryable).toBe(false);
  });
});
