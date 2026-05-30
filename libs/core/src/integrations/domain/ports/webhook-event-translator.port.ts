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
   */
  translate(event: InboundWebhookEvent): CanonicalInboundEvent | null;
}
