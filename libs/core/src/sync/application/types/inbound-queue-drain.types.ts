/**
 * Inbound Queue Drain Types (#4179)
 *
 * @module application/types
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { InboundQueueReader } from '@openlinker/core/integrations';

export interface InboundQueueDrainInput {
  readonly connection: Connection;
  /** The adapter manifest's capabilities; the routing gate reads them, as for a webhook. */
  readonly supportedCapabilities: readonly string[];
  readonly reader: InboundQueueReader;
  readonly maxMessages: number;
}

export interface InboundQueueDrainResult {
  readonly received: number;
  /** Events turned into jobs (a duplicate notification dedups on its message id). */
  readonly enqueued: number;
  /** Events whose domain needs a capability the connection does not have. */
  readonly ungated: number;
  /** Messages the adapter could not read; acknowledged so they are not received for ever. */
  readonly unreadable: number;
  readonly acknowledged: number;
  /** Messages left on the queue because routing one of their events failed. */
  readonly retained: number;
}
