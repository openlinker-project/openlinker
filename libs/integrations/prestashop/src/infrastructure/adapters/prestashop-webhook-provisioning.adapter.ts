/**
 * PrestaShop Webhook Provisioning Adapter
 *
 * Implements `WebhookProvisioningPort` (#583) for the PrestaShop platform —
 * orchestrates the auto-provisioning flow for the PS `openlinker` module's
 * webhook configuration (#168). Replaces the manual flow where an operator
 * pasted Base URL + Connection ID + Webhook Secret into the PS admin form.
 *
 * Resolved per-connection by `ConnectionService.installWebhooks` via the
 * `WebhookProvisioningRegistryService` indexed by `adapterKey`. Self-registers
 * in `PrestashopIntegrationModule.onModuleInit` alongside the adapter
 * factory and connection tester.
 *
 * Flow:
 *   1. Validate connection config (callback URL set, baseUrl set).
 *   2. Rotate the connection's webhook secret (one-shot plaintext return).
 *   3. Push the three config rows to PS via WS `configurations` resource.
 *   4. Mark `connection.config.webhooksConfigured = true`.
 *   5. Fire a synchronous HMAC-signed `test_ping` trigger to the PS module.
 *
 * Failure-mode policy: accept-and-surface. Partial states return a `warning`
 * field so the FE can render operator-actionable text.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters
 * @implements {WebhookProvisioningPort}
 */
import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { Logger } from '@openlinker/shared/logging';
import { ConnectionPort, CONNECTION_PORT_TOKEN } from '@openlinker/core/identifier-mapping';
import type {
  WebhookProvisioningPort,
  WebhookProvisioningResult,
} from '@openlinker/core/integrations';
import {
  IWebhookSecretService,
  WEBHOOK_SECRET_SERVICE_TOKEN,
  CredentialsResolverPort,
  CREDENTIALS_RESOLVER_TOKEN,
} from '@openlinker/core/integrations';
import type { PrestashopConnectionConfig } from '../../domain/types/prestashop-config.types';
import type { PrestashopCredentials } from '../../domain/types/prestashop-credentials.types';
import { PrestashopWebserviceClient } from '../http/prestashop-webservice.client';
import type { IPrestashopWebserviceClient } from '../http/prestashop-webservice.client.interface';

const PROVIDER = 'prestashop';

/** Configuration keys written into PS by the install flow. */
const CONFIG_KEYS = {
  baseUrl: 'OPENLINKER_BASE_URL',
  connectionId: 'OPENLINKER_CONNECTION_ID',
  webhookSecret: 'OPENLINKER_WEBHOOK_SECRET',
} as const;

@Injectable()
export class PrestashopWebhookProvisioningAdapter implements WebhookProvisioningPort {
  private readonly logger = new Logger(PrestashopWebhookProvisioningAdapter.name);

  constructor(
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connectionPort: ConnectionPort,
    @Inject(WEBHOOK_SECRET_SERVICE_TOKEN)
    private readonly webhookSecretService: IWebhookSecretService,
    @Inject(CREDENTIALS_RESOLVER_TOKEN)
    private readonly credentialsResolver: CredentialsResolverPort
  ) {}

  async install(connectionId: string, actorUserId?: string): Promise<WebhookProvisioningResult> {
    // Step 1 — validate connection config. Routing by adapterKey via the
    // registry guarantees this adapter only sees PS connections; the
    // unsupported-platform 400 lives in `ConnectionService.installWebhooks`.
    const connection = await this.connectionPort.get(connectionId);
    const config = connection.config as Partial<PrestashopConnectionConfig>;
    const callbackUrl = config.openlinkerCallbackBaseUrl;

    if (!callbackUrl || typeof callbackUrl !== 'string') {
      throw new BadRequestException(
        'Set the OL callback URL on the connection-edit page before configuring ' +
          'webhooks. The PS module needs to know where to POST events back to OL ' +
          '(e.g. http://host.docker.internal:3000 in dev, your public OL URL in prod).'
      );
    }

    if (!config.baseUrl || typeof config.baseUrl !== 'string') {
      // Defensive — should be caught by DTO at save time. Mirrored here so the
      // adapter stays usable in tests / programmatic call paths.
      throw new BadRequestException(`Connection ${connectionId} is missing baseUrl in config.`);
    }

    // Step 2 — rotate secret (one-shot plaintext)
    const { secret } = await this.webhookSecretService.rotate(PROVIDER, connectionId, actorUserId);

    // Step 3 — push 3 config rows via PS WS
    const wsClient = await this.createWebserviceClient(connection.credentialsRef, config);

    try {
      await this.upsertConfiguration(wsClient, CONFIG_KEYS.baseUrl, callbackUrl);
      await this.upsertConfiguration(wsClient, CONFIG_KEYS.connectionId, connectionId);
      await this.upsertConfiguration(wsClient, CONFIG_KEYS.webhookSecret, secret);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to push webhook configuration to PS for connection ${connectionId}: ${message}`
      );
      throw new BadRequestException(
        `Configuration push to PrestaShop failed: ${message}. ` +
          `The webhook secret was rotated on OL's side; PS still has the previous ` +
          `value. Click 'Configure webhooks' again to retry.`
      );
    }

    // Step 4 — mark configured
    let stateUpdateOk = true;
    try {
      await this.connectionPort.update(connectionId, {
        config: { ...connection.config, webhooksConfigured: true },
      });
    } catch (error) {
      stateUpdateOk = false;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Webhook configuration pushed to PS but state update failed for ` +
          `${connectionId}: ${message}. PS has the right config; OL did not record success. ` +
          `Re-running install is safe (idempotent).`
      );
    }

    // Step 5 — fire test ping (best-effort)
    let pingOk = false;
    try {
      pingOk = await this.firePing(config.baseUrl, secret, connectionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Test ping fire failed for connection ${connectionId}: ${message}. ` +
          `Configuration is correct; verification just did not complete.`
      );
    }

    this.logger.log(
      `webhook_install.completed connectionId=${connectionId} ` +
        `webhooksConfigured=${stateUpdateOk} testPingTriggered=${pingOk} ` +
        `actor=${actorUserId ?? 'system'}`
    );

    if (!stateUpdateOk) {
      return {
        webhooksConfigured: false,
        testPingTriggered: pingOk,
        warning: 'state-update-failed',
      };
    }
    if (!pingOk) {
      return {
        webhooksConfigured: true,
        testPingTriggered: false,
        warning: 'ping-not-received',
      };
    }
    return { webhooksConfigured: true, testPingTriggered: true };
  }

  /**
   * Upsert a `ps_configuration` row by name via PS WS.
   *
   * PS WS `configurations` is keyed by id, not name — we have to list-by-name
   * first to find an existing id, then update or create. Body shape uses
   * the bare `{ name, value }` form which writes to the global scope on
   * single-store and PS 8.x defaults; multi-store hosts may require explicit
   * `id_shop_group`/`id_shop` (handled by retry-with-defaults if the bare
   * body fails — see #168 plan).
   */
  private async upsertConfiguration(
    wsClient: IPrestashopWebserviceClient,
    name: string,
    value: string
  ): Promise<void> {
    // TODO(#168 multi-store): if PS ≥ 8.2 with multi-store rejects the bare
    // `{ name, value }` body, retry with explicit `id_shop_group: 1, id_shop: 1`.
    // The bare body is correct for single-store and the most common multi-store
    // configurations (PS 8.0/8.1 default to global scope). Plan section
    // "Open questions (resolved) #2" documents the fallback shape.
    const existing = await wsClient.listResources<{ id: string | number }>(
      'configurations',
      { custom: { name } },
      1,
      0
    );
    if (existing.length > 0) {
      const id = existing[0].id;
      // PS WS PUT requires `id` in the body to match the path id; the
      // singular-resource wrapper (`{ prestashop: { configuration: ... } }`)
      // is added by `writeResource` in the WS client — callers must pass
      // flat fields. (#541)
      await wsClient.updateResource('configurations', id, {
        id: String(id),
        name,
        value,
      });
      return;
    }
    await wsClient.createResource('configurations', { name, value });
  }

  /**
   * POST a HMAC-signed `test_ping` trigger to the PS module's
   * `controllers/front/ping.php`. The module verifies the signature using
   * the just-written `OPENLINKER_WEBHOOK_SECRET`, then synchronously fires
   * a webhook event back to OL — round-trip completes inside this call's
   * wall-clock window.
   *
   * Returns true on 2xx, false otherwise. Never throws (caller wraps).
   */
  private async firePing(
    psBaseUrl: string,
    secret: string,
    connectionId: string
  ): Promise<boolean> {
    const url = `${psBaseUrl.replace(/\/$/, '')}/module/openlinker/ping`;
    const body = JSON.stringify({ event: 'test.ping', connectionId });
    const timestamp = String(Date.now());
    const signedPayload = `${timestamp}.${body}`;
    const signatureHex = createHmac('sha256', secret).update(signedPayload).digest('hex');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-OpenLinker-Timestamp': timestamp,
          'X-OpenLinker-Signature': `sha256=${signatureHex}`,
        },
        body,
        signal: controller.signal,
      });
      return res.ok;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async createWebserviceClient(
    credentialsRef: string,
    config: Partial<PrestashopConnectionConfig>
  ): Promise<IPrestashopWebserviceClient> {
    const credentials = await this.credentialsResolver.get<PrestashopCredentials>(credentialsRef);
    return new PrestashopWebserviceClient(
      config.baseUrl as string,
      credentials,
      config as PrestashopConnectionConfig
    );
  }
}
