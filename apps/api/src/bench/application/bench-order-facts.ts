/**
 * Order facts the bench is allowed to read (#2416, extracted by #2418,
 * re-pointed at the shared reader by #3426)
 *
 * Two projections off an `OrderRecord`, and NOTHING else from the snapshot.
 *
 * These were module-private helpers in `BenchWorkService` until the parcel read
 * needed the same two answers. Restating them would have given one surface two
 * spellings of a packer's own order reference — and, worse, two chances for a
 * second field to be taken from the snapshot without anybody noticing. There is
 * one place a bench reads an order, and this is it.
 *
 * Since #3426 the snapshot mechanics themselves live one level up, in
 * `apps/api/src/common/orders/order-snapshot-facts`, because the Assign Packing
 * Work board reads the same `orderNumber` and a second copy of that read is the
 * drift this file exists to prevent — one directory wider. This module keeps
 * its identity: it is still the one place a bench reads an order, and it is
 * still where a bench-specific answer would be added.
 *
 * The bench discloses the buyer's name IN FULL, deliberately: that name goes on
 * the label a packer prints (#2416's already-decided PII call). The assign
 * board masks the same field (#3425). Two surfaces, one read, two transforms —
 * which is exactly why the transform is not in the shared module.
 *
 * Pure: no I/O, no clock, no injected dependency.
 *
 * @module apps/api/src/bench/application
 */
export { readBuyerName, readOrderReference } from '../../common/orders/order-snapshot-facts';
