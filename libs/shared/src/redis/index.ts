/**
 * Redis Module Export
 *
 * @module libs/shared/src/redis
 */
export { RedisConfigModule } from './redis-config.module';
export {
  ackTrimmed,
  MAX_DRAIN_PAGES,
  MIN_RECLAIM_IDLE_MS,
  readOwnPending,
  RECLAIM_INTERVAL_MS,
  reclaimOrphans,
  resolveConsumerName,
  toClaimedMessage,
  toPendingRows,
  WORKER_ID_ENV,
} from './stream-consumer';
export type { PendingRow, StreamConsumerClient, StreamEntry } from './stream-consumer';
