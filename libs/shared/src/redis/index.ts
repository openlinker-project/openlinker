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
  nextPendingCursor,
  readOwnPending,
  RECLAIM_INTERVAL_MS,
  RECOVERY_PAGES_PER_TICK,
  reclaimOrphans,
  RecoveryAttemptTracker,
  MAX_RECOVERY_ATTEMPTS,
  MAX_TRACKED_ATTEMPTS,
  resolveConsumerName,
  toClaimedMessage,
  toPendingRows,
  WORKER_ID_ENV,
} from './stream-consumer';
export type {
  PendingRow,
  RecoveryLogger,
  RecoveryOutcome,
  StreamConsumerClient,
  StreamEntry,
} from './stream-consumer';
