/**
 * Inbound Webhook Routing Service Interface
 *
 * The translate→resolve half of webhook ingress (#2280): maps a verified
 * `InboundWebhookEvent` to a routing outcome synchronously at ingress, using
 * the same seams the retired stream consumer used (adapter metadata →
 * translator registry → `IInboundRoutingPolicyService.resolve`). No enqueue,
 * no persistence — the gate transaction owns the write.
 *
 * @module apps/api/src/webhooks/application/interfaces
 */
import type { InboundWebhookEvent } from '@openlinker/core/events';
import type { InboundWebhookRoutingOutcome } from '../types/inbound-webhook-routing.types';

export const INBOUND_WEBHOOK_ROUTING_SERVICE_TOKEN = Symbol('IInboundWebhookRoutingService');

export interface IInboundWebhookRoutingService {
  /**
   * Resolve a verified inbound webhook event to its routing outcome.
   *
   * Deterministic non-routable states (`ping`, `unroutable`) return; transient
   * failures (e.g. a DB blip while resolving the adapter) THROW so the caller
   * 5xxs and the source retries — the ADR-015 invariant that an infra blip
   * never silently drops a webhook, relocated from the stream consumer.
   */
  resolveEvent(event: InboundWebhookEvent): Promise<InboundWebhookRoutingOutcome>;
}
