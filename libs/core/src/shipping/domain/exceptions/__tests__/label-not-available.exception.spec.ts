/**
 * LabelNotAvailableException — message substring pinned for the FE mapper (#2671, PR #2700 review).
 *
 * `apps/web/src/features/shipments/lib/label-download-error.ts` distinguishes
 * this exception's 422 from `LabelDocumentNotSupportedException`'s 422 purely
 * by testing `error.message.includes('generate the label first')` - the
 * controller wraps both in a bare `UnprocessableEntityException` with no
 * exception-name field on the wire. A reword here silently reroutes every
 * "label not generated yet" download into the FE's "carrier doesn't support
 * labels" copy. This spec is what turns that reword into a failing build.
 */
import { LabelNotAvailableException } from '../label-not-available.exception';

describe('LabelNotAvailableException', () => {
  it('should keep the substring the FE label-download mapper keys on', () => {
    const error = new LabelNotAvailableException('shipment-1');

    expect(error.message).toContain('generate the label first');
  });

  it('should have a stable `name` field', () => {
    const error = new LabelNotAvailableException('shipment-1');

    expect(error.name).toBe('LabelNotAvailableException');
  });
});
