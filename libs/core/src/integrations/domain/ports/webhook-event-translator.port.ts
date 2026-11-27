/**
 * Webhook Event Translator Port
 *
 * Per-plugin capability that decodes a provider's inbound webhook event into
 * a neutral `CanonicalInboundEvent` (ADR-015). It is a **pure, payload-in
 * transform** — no I/O, no connection state — so it joins the shape-validator
 * / OAuth-completion family of host-bag registries, registered in each
 * plugin's `register(host)` keyed by `adapterKey`
 * (`WebhookEventTranslatorRegistryService`). The registry *mechanics* mirror
 * `WebhookProvisioning`; the *semantics* match the pure validators.
 *
 * A plugin maps its **own** webhook vocabulary across **all** the domains it
 * emits (a single connection may push product + stock + order). It knows
 * nothing about job types — domain→job routing is the core routing policy's
 * job. The translator must be **total**: it returns `null` for events it
 * cannot decode (→ dead-letter) rather than throwing unbounded (only
 * signature-verified payloads reach it).
 *
 * One delivery may stand for more than one change. A platform that sends a
 * single event name for two distinct facts (Shoper's `product.edit` covers both
 * a product edit and a panel stock edit) returns an ARRAY, and the ingress
 * creates one job per resolvable element in the same gate transaction. The
 * fan-out lives here, in the plugin, so the core routing table stays a
 * one-event-one-job function and every single-event plugin is unchanged.
 *
 * @module libs/core/src/integrations/domain/ports
 * @see {@link CanonicalInboundEvent} for the neutral output contract
 */
import type { InboundWebhookEvent } from '@openlinker/core/events';
import type { CanonicalInboundEvent } from '../types/canonical-inbound-event.types';

export interface WebhookEventTranslatorPort {
  /**
   * Decode a provider-native inbound webhook event into a neutral
   * `CanonicalInboundEvent`, or `null` when the event is not decodable by
   * this plugin (unknown object type / event type → dead-letter).
   *
   * An array means the delivery stands for several changes. ORDER MATTERS: the
   * first element is the PRIMARY event - its job carries the unchanged
   * `{platformType}:{connectionId}:{sourceEventId}` key and is the job recorded
   * on the delivery row, so a plugin must list the event an operator would call
   * "what this webhook was" first. An empty array is treated exactly like
   * `null` (undecodable, dead-lettered).
   */
  translate(
    event: InboundWebhookEvent
  ): CanonicalInboundEvent | readonly CanonicalInboundEvent[] | null;
}
