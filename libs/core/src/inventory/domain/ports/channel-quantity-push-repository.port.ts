/**
 * Channel Quantity Push Repository Port (#4062)
 *
 * Persistence contract for the append-only record of quantities OpenLinker
 * wrote to channels. See `channel-quantity-push.types.ts`.
 *
 * @module libs/core/src/inventory/domain/ports
 */
import type {
  AppendChannelQuantityPushInput,
  ChannelQuantityPush,
  LastChannelQuantityPush,
} from '../types/channel-quantity-push.types';

export interface ChannelQuantityPushRepositoryPort {
  appendMany(inputs: readonly AppendChannelQuantityPushInput[]): Promise<void>;

  /** Every push that expressed one stock observation of one variant, oldest first. */
  findForObservation(productVariantId: string, observedAt: Date): Promise<ChannelQuantityPush[]>;

  /** The newest push per (variant, connection), for the given variants. */
  findLatestByVariantIds(productVariantIds: readonly string[]): Promise<LastChannelQuantityPush[]>;

  /** Deletes up to `batchSize` rows pushed before `cutoff`, oldest first; returns the count. */
  pruneOlderThan(cutoff: Date, batchSize: number): Promise<number>;
}
