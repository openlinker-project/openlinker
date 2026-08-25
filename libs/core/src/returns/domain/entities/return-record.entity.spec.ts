/**
 * ReturnRecord — unit spec (#2332)
 *
 * `isOrphan()` is THE definition of orphan for the whole context, so it gets its own
 * spec rather than being asserted incidentally through a consumer.
 *
 * @module domain/entities
 */
import { ReturnRecord } from './return-record.entity';

const buildRecord = (internalOrderId: string | null): ReturnRecord =>
  new ReturnRecord(
    'ol_return_x',
    '11111111-1111-1111-1111-111111111111',
    'RET-1',
    internalOrderId,
    'SRC-ORDER-1',
    'source_ingested',
    'WAITING',
    null,
    null,
    null,
    null,
    null,
    new Date('2026-08-01T00:00:00Z'),
    new Date('2026-08-01T00:00:00Z'),
    []
  );

describe('ReturnRecord', () => {
  describe('isOrphan', () => {
    it('should report orphan when OL could not attribute the return to an order', () => {
      expect(buildRecord(null).isOrphan()).toBe(true);
    });

    it('should report not-orphan when the return names an internal order', () => {
      expect(buildRecord('ol_order_abc').isOrphan()).toBe(false);
    });

    it('should not treat a source order reference as attribution', () => {
      // The source naming an order is not OL knowing which order — that is exactly the
      // gap the orphan bucket exists to represent, and the reason a return can carry an
      // `externalOrderId` and still be orphaned.
      const record = buildRecord(null);

      expect([record.externalOrderId, record.isOrphan()]).toEqual(['SRC-ORDER-1', true]);
    });
  });
});
