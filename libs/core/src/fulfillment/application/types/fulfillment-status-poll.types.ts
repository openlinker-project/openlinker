/**
 * Fulfillment Status Poll Types
 *
 * Input and result of one page of `IFulfillmentStatusPollService.pollConnection`.
 *
 * @module libs/core/src/fulfillment/application/types
 */
import type { FulfillmentStatusSource } from '../../domain/ports/capabilities/fulfillment-status-source.capability';
import type { FulfillmentRelayIntent } from '../../domain/types/fulfillment-progress-event.types';

export interface PollFulfillmentStatusInput {
  /** The executor connection whose accepted work is read. */
  readonly connectionId: string;
  /** The holder's status read, narrowed by the caller (an argument, ADR-053). */
  readonly source: FulfillmentStatusSource;
  /** Works per page. */
  readonly limit: number;
  /** Rolling scan offset over the connection's live accepted works. */
  readonly offset: number;
  readonly now: Date;
}

export interface PollFulfillmentStatusResult {
  /** Works read on this page. */
  readonly polled: number;
  /** Progress events recorded (duplicates not counted). */
  readonly recorded: number;
  /** Works whose status read or recording failed; the next poll tries again. */
  readonly failed: number;
  /** Offset for the next page; 0 once the page was the last one. */
  readonly nextOffset: number;
  /** What the recorded events ask the caller to do (dispatch relay, re-route). */
  readonly intents: readonly FulfillmentRelayIntent[];
}
