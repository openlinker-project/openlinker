/**
 * Returns — public barrel (#2327)
 *
 * ADR-060: returns are an OL-owned aggregate ABOVE the source projection, in a
 * context of their own. Folding them into `orders` — already the most
 * outbound-coupled context in the tree — would have made that context worse,
 * and returns carry authority questions (custody, disposition, restock) that
 * are the operator's, not the source's.
 *
 * This slice is the model and its schema only. No service, no ingestion, no
 * transitions, no restock, no API. See `ReturnRepositoryPort` for the map of
 * what widens this barrel and when.
 *
 * NOT re-exported from the aggregating root barrel (`libs/core/src/index.ts`) —
 * the `sales-documents` posture; the root barrel is not an inventory of
 * contexts, and this one is reached at its own `@openlinker/core/returns`
 * subpath.
 *
 * @module libs/core/src/returns
 * @see docs/architecture/adrs/060-returns-aggregate-above-source-projection.md
 */
export * from './domain/types/return.types';
export * from './domain/types/return-line.types';
export { ReturnRecord } from './domain/entities/return-record.entity';
export { ReturnLine } from './domain/entities/return-line.entity';
export type { ReturnRepositoryPort } from './domain/ports/return-repository.port';
export { ReturnsModule } from './returns.module';
export * from './returns.tokens';

// Source projection (#2329): the neutral read-only shapes a `ReturnSourceReader`
// reports. Non-authoritative — custody/disposition/restock stay with ReturnRecord.
export type { IncomingReturn, IncomingReturnLine } from './domain/types/incoming-return.types';
export type {
  ReturnFeedInput,
  ReturnFeedItem,
  ReturnFeedOutput,
} from './domain/types/return-feed.types';
