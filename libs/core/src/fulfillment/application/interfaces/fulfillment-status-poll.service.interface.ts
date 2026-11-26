/**
 * Fulfillment Status Poll Service Interface
 *
 * Reads a POLLING holder's progress (`FulfillmentStatusSource`) for the work it
 * accepted and records it through `IFulfillmentProgressService`, so work an
 * executor such as Amazon Multi-Channel Fulfillment ships moves in OpenLinker
 * without a webhook. The holder's adapter enters as an argument (ADR-053): the
 * worker resolves and narrows it. Relay intents are REPORTED, never performed;
 * the caller composes them (a dispatch relay lives outside this context).
 *
 * @module libs/core/src/fulfillment/application/interfaces
 */
import type {
  PollFulfillmentStatusInput,
  PollFulfillmentStatusResult,
} from '../types/fulfillment-status-poll.types';

export interface IFulfillmentStatusPollService {
  pollConnection(input: PollFulfillmentStatusInput): Promise<PollFulfillmentStatusResult>;
}
