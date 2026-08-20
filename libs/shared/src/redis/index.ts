/**
 * Redis Module Export
 *
 * @module libs/shared/src/redis
 */
export { RedisConfigModule } from './redis-config.module';
export {
  ackTrimmed,
  MIN_RECLAIM_IDLE_MS,
  readOwnPending,
  reclaimOrphans,
  resolveConsumerName,
  toPendingRows,
  WORKER_ID_ENV,
} from './stream-consumer';
export type { PendingRow, StreamConsumerClient, StreamEntry } from './stream-consumer';
