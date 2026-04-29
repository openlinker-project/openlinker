/**
 * Order Destination Retry Service Interface
 *
 * Defines the contract for retrying a failed destination sync of an existing
 * OrderRecord. The service re-enqueues the source-side `marketplace.order.sync`
 * job with a fresh idempotency key so the worker re-fans-out to all
 * destinations. Already-synced destinations stay synced via destination-adapter
 * idempotency (#348); only the previously-failed destination is materially
 * re-attempted.
 *
 * @module libs/core/src/orders/application/interfaces
 */
import type { JobType } from '@openlinker/core/sync';

export interface OrderDestinationRetryInput {
  /** Internal order id (`ol_order_*`) */
  internalOrderId: string;
  /** Destination connection id whose row was clicked Retry on */
  destinationConnectionId: string;
}

export interface OrderDestinationRetryResult {
  /** Sync-job row id created for this retry */
  jobId: string;
  /** Job type — always `marketplace.order.sync` for now */
  jobType: JobType;
}

export interface IOrderDestinationRetryService {
  /**
   * Retry a failed destination sync.
   *
   * Validates the OrderRecord exists, the destination row exists and is
   * currently `failed`, claims the slot by flipping it to `pending`,
   * resolves the source external id, then enqueues a fresh
   * `marketplace.order.sync` job. On enqueue failure the status is
   * reverted to `failed` with the original error preserved.
   *
   * @throws {OrderRecordNotFoundException} if the order does not exist
   * @throws {OrderDestinationNotFoundException} if the destination row is missing
   * @throws {OrderDestinationNotRetryableException} if status !== 'failed'
   * @throws {MissingSourceExternalIdException} if source identifier mapping is missing
   */
  retry(input: OrderDestinationRetryInput): Promise<OrderDestinationRetryResult>;
}
