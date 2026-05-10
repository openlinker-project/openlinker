/**
 * Webhook Provisioning Port
 *
 * Capability contract for auto-provisioning a connection's webhook
 * configuration on its destination platform. Implemented per-platform
 * (e.g., `PrestashopWebhookProvisioningAdapter` writes to PS WS
 * `configurations`; future Shopify/Allegro adapters would call their own
 * platform's webhook-registration API). Resolved per-connection by
 * `ConnectionService.installWebhooks` via the
 * `WebhookProvisioningRegistryService` indexed by `adapterKey` (#583).
 *
 * Implementations follow the accept-and-surface failure-mode policy: the
 * port throws on hard validation failures (BadRequestException for
 * unsupported platforms, missing required config) but returns a
 * `WebhookProvisioningResult` with `warning` set on partial-success states
 * so the controller layer can return 200 and let the FE render
 * operator-actionable text.
 *
 * @module libs/core/src/integrations/domain/ports
 */
import type { WebhookProvisioningResult } from '../types/webhook-provisioning.types';

export interface WebhookProvisioningPort {
  /**
   * Install webhook configuration on the destination platform for the
   * given connection. Side-effects are platform-specific but always
   * include: rotating the connection's webhook secret, writing the
   * configuration to the platform, recording `webhooksConfigured: true`
   * on the connection, and (when supported) firing a synchronous test
   * ping to verify the round-trip.
   *
   * @param connectionId - The connection to configure.
   * @param actorUserId - Optional acting user (forwarded to audit logs).
   * @returns The structured result; `warning` is set on partial-success.
   * @throws BadRequestException for unsupported configurations
   *   (e.g., missing callback URL).
   */
  install(connectionId: string, actorUserId?: string): Promise<WebhookProvisioningResult>;
}
