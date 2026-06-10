/**
 * Inbound Webhook Decoder Registry Service
 *
 * Holds `InboundWebhookDecoderPort` implementations keyed by `provider` (the
 * `/webhooks/:provider/:connectionId` path segment) — ADR-021. The host
 * webhook service resolves a connection's decoder by provider before dedup,
 * falling back to the registered OpenLinker default decoder when none is
 * registered (so PrestaShop/Allegro stay on the OL-HMAC + `WebhookRequestDto`
 * path unchanged).
 *
 * Keyed by `provider`, not `adapterKey`, because signature + secret already
 * resolve by `(provider, connectionId)` at the controller layer and
 * `adapterKey` resolves only downstream — see ADR-021 / DESIGN-021 F1. Silent
 * overwrite on duplicate key mirrors the sister registries; the host registers
 * its default and plugins register exactly once at boot.
 *
 * @module libs/core/src/integrations/infrastructure/adapters
 * @see {@link InboundWebhookDecoderPort} for the port interface
 */
import { Injectable } from '@nestjs/common';
import type { InboundWebhookDecoderPort } from '../../domain/ports/inbound-webhook-decoder.port';

@Injectable()
export class InboundWebhookDecoderRegistryService {
  private readonly decoders: Map<string, InboundWebhookDecoderPort> = new Map();

  register(provider: string, decoder: InboundWebhookDecoderPort): void {
    this.decoders.set(provider, decoder);
  }

  get(provider: string): InboundWebhookDecoderPort | undefined {
    return this.decoders.get(provider);
  }

  has(provider: string): boolean {
    return this.decoders.has(provider);
  }
}
