/**
 * Allegro Job Payload Types
 *
 * Type definitions for Allegro-specific job payloads. Each job type has
 * a corresponding payload interface that defines the required data for
 * executing the job.
 *
 * This file contains types only (per engineering standards).
 *
 * @module libs/core/src/sync/domain/types
 */

/**
 * Allegro Orders Poll Job Payload
 *
 * Payload for the `allegro.orders.poll` job type. This job polls Allegro's
 * event journal for new order events and enqueues individual order sync jobs.
 *
 * Note: `connectionId` is available from `SyncJob.connectionId` and should be
 * used for cursor operations (e.g., `ConnectionCursorRepositoryPort.get(connectionId, cursorKey)`).
 */
export interface AllegroOrdersPollPayload {
  /**
   * Cursor key for tracking the last processed event ID
   * (e.g., 'allegro.orders.lastEventId')
   */
  cursorKey: string;

  /**
   * Maximum number of events to process in a single poll
   * (defaults to adapter limit if not specified)
   */
  limit?: number;
}

/**
 * Allegro Order Sync By Checkout Form ID Job Payload
 *
 * Payload for the `allegro.order.syncByCheckoutFormId` job type. This job
 * fetches a full order from Allegro by checkout form ID and processes it
 * through the OrderSync pipeline.
 *
 * Note: `connectionId` is available from `SyncJob.connectionId` and should be
 * used for adapter resolution and identifier mapping operations.
 */
export interface AllegroOrderSyncByCheckoutFormIdPayload {
  /**
   * Allegro checkout form ID (external ID)
   */
  checkoutFormId: string;

  /**
   * Event ID from the event journal (for idempotency and traceability)
   */
  eventId: string;
}

/**
 * Allegro Offer Quantity Update Job Payload
 *
 * Payload for the `allegro.offerQuantity.update` job type. This job updates
 * the quantity of an Allegro offer using the command pattern.
 *
 * Note: `connectionId` is available from `SyncJob.connectionId` and should be
 * used for adapter resolution and identifier mapping operations.
 */
export interface AllegroOfferQuantityUpdatePayload {
  /**
   * Allegro offer ID (external ID)
   */
  offerId: string;

  /**
   * New quantity value
   */
  quantity: number;

  /**
   * Idempotency key for deduplication (format: allegro:{connectionId}:{offerId}:{timestamp})
   */
  idempotencyKey: string;
}

