/**
 * Shoper Webhook Provisioning Adapter (#3644)
 *
 * Implements `WebhookProvisioningPort` for Shoper: registers ONE webhook on the
 * shop carrying every order event, pointing at
 * `${openlinkerCallbackBaseUrl}/webhooks/shoper/${connectionId}?token=<secret>`.
 * Registered by `ShoperIntegrationModule` (it needs `ConnectionPort` and
 * `IWebhookSecretService`, which `HostServices` does not carry), indexed by
 * `adapterKey` in `WebhookProvisioningRegistryService`, and reached through the
 * operator action `POST /connections/:id/webhooks/install`.
 *
 * IDEMPOTENT: the token changes on every install (the secret is rotated), so the
 * webhook is recognised by its URL WITHOUT the query string; matching the whole URL
 * would stack a new registration on the shop per install. A match is `PUT`, no
 * match is `POST`. Every match (duplicates left by hand included) is `PUT`, so none
 * keeps a rotated-out token; duplicates are warned about and never deleted.
 *
 * ROTATE-THEN-REGISTER: the new secret must go into the URL, so `rotate()` runs
 * first and invalidates the old token at once. If the shop write then fails, a
 * previously working setup rejects deliveries until install is re-run
 * (`webhooksConfigured` is flipped to false meanwhile). `shoper-orders-poll` is what
 * covers that window - for new orders only - and must therefore not be turned off.
 * Re-running install also rotates the token, which is the remedy if it leaks (it
 * travels in the URL and so can appear in proxy/CDN access logs).
 *
 * REFUSES WHEN `OrderSource` IS NOT ENABLED on the connection. `OrderSource` is
 * opt-in for Shoper (#3711) and the routing gate (`InboundRoutingPolicy`) answers
 * `ungated` unless the connection enables it, so an install that succeeded would
 * register webhooks whose every delivery is authenticated, accepted and then
 * dead-lettered. The gate is read from `connection.enabledCapabilities`, never
 * from a `platformType` test.
 *
 * @module libs/integrations/shoper/src/infrastructure/adapters
 * @implements {WebhookProvisioningPort}
 */
import { BadRequestException } from '@nestjs/common';
import type { Connection, ConnectionPort } from '@openlinker/core/identifier-mapping';
import type {
  CredentialsResolverPort,
  IWebhookSecretService,
  WebhookProvisioningPort,
  WebhookProvisioningResult,
} from '@openlinker/core/integrations';
import type { HttpTransportFactoryPort } from '@openlinker/shared/http';
import { Logger } from '@openlinker/shared/logging';

import { parseShoperBaseUrl } from '../../domain/policies/shoper-base-url.policy';
import type { ShoperCredentials } from '../../domain/types/shoper-credentials.types';
import {
  SHOPER_ORDER_WEBHOOK_EVENTS,
  SHOPER_WEBHOOK_PROVIDER,
  SHOPER_WEBHOOK_TOKEN_QUERY_KEY,
  SHOPER_WEBHOOKS_PATH,
  type ShoperWebhookRow,
  type ShoperWebhookWriteBody,
} from '../../domain/types/shoper-webhook.types';
import { ShoperHttpClient } from '../http/shoper-http-client';
import { SHOPER_MAX_PAGE_SIZE, fetchShoperPage } from '../http/shoper-pagination';

/** The capability the routing gate requires for an `order` delivery. */
const REQUIRED_CAPABILITY = 'OrderSource';

export class ShoperWebhookProvisioningAdapter implements WebhookProvisioningPort {
  private readonly logger = new Logger(ShoperWebhookProvisioningAdapter.name);

  constructor(
    private readonly connectionPort: ConnectionPort,
    private readonly webhookSecretService: IWebhookSecretService,
    private readonly credentialsResolver: CredentialsResolverPort,
    private readonly http: HttpTransportFactoryPort,
  ) {}

  async install(connectionId: string, actorUserId?: string): Promise<WebhookProvisioningResult> {
    const connection = await this.connectionPort.get(connectionId);

    if (!connection.enabledCapabilities.includes(REQUIRED_CAPABILITY)) {
      throw new BadRequestException(
        'Enable the Order source capability on this connection before configuring webhooks: ' +
          'without it OpenLinker would accept every Shoper delivery and then discard it.',
      );
    }

    const config = (connection.config ?? {}) as Record<string, unknown>;
    const callbackBaseUrl =
      typeof config.openlinkerCallbackBaseUrl === 'string' ? config.openlinkerCallbackBaseUrl.trim() : '';
    if (callbackBaseUrl.length === 0) {
      throw new BadRequestException(
        'Set the OpenLinker callback URL on the connection-edit page before configuring webhooks. ' +
          'Shoper needs to know where to POST events back to OpenLinker ' +
          '(your public OpenLinker URL; it must be reachable from the shop).',
      );
    }
    const base = parseShoperBaseUrl(config.baseUrl);
    if (!base.ok) {
      throw new BadRequestException(`Connection ${connectionId} has an unusable baseUrl: ${base.issues.join('; ')}`);
    }
    if (!connection.credentialsRef) {
      throw new BadRequestException(`Connection ${connectionId} has no stored credentials.`);
    }
    const credentials = await this.credentialsResolver.get<ShoperCredentials>(connection.credentialsRef);
    if (typeof credentials.token !== 'string' || credentials.token.trim().length === 0) {
      throw new BadRequestException(`Connection ${connectionId} has no API token stored.`);
    }

    // One-shot plaintext. It is also the delivery token: Shoper is told the URL
    // carrying it, and OpenLinker verifies it on every delivery.
    const { secret } = await this.webhookSecretService.rotate(SHOPER_WEBHOOK_PROVIDER, connectionId, actorUserId);

    const client = new ShoperHttpClient(
      { host: base.host, token: credentials.token },
      this.http.forConnection(connection),
    );
    const endpoint = `${callbackBaseUrl.replace(/\/+$/, '')}/webhooks/${SHOPER_WEBHOOK_PROVIDER}/${connectionId}`;
    const deliveryUrl = `${endpoint}?${SHOPER_WEBHOOK_TOKEN_QUERY_KEY}=${encodeURIComponent(secret)}`;
    const body: ShoperWebhookWriteBody = {
      url: deliveryUrl,
      events: SHOPER_ORDER_WEBHOOK_EVENTS,
      active: 1,
      format: 0,
      secret,
    };

    try {
      await this.upsert(client, endpoint, body, connectionId);
    } catch (error) {
      // Shoper echoes the rejected URL in its error text (`'<url>' nie jest poprawnym
      // adresem URL`), and that URL carries the token: redact it before the message is
      // logged or returned to the operator.
      const message = redactSecret(error instanceof Error ? error.message : String(error), secret);
      this.logger.error(`Failed to register Shoper webhooks for connection ${connectionId}: ${message}`);
      // Fail-closed visibility: the secret was already rotated OpenLinker-side, so
      // the shop may still hold the old URL until install is re-run. Flip the
      // persisted flag so a prior `true` does not go stale.
      await this.markWebhooksUnconfigured(connectionId, connection.config);
      throw new BadRequestException(
        `Shoper webhook registration failed: ${message}. The webhook secret was rotated on ` +
          "OpenLinker's side; re-running install is safe (registration is idempotent).",
      );
    }

    let stateUpdateOk = true;
    try {
      await this.connectionPort.update(connectionId, {
        config: { ...connection.config, webhooksConfigured: true },
      });
    } catch (error) {
      stateUpdateOk = false;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Shoper webhooks registered but the connection state update failed for ${connectionId}: ${message}. ` +
          'The shop has the right configuration; re-running install is idempotent.',
      );
    }

    this.logger.log(
      `webhook_install.completed connectionId=${connectionId} provider=${SHOPER_WEBHOOK_PROVIDER} ` +
        `webhooksConfigured=${stateUpdateOk} events=${SHOPER_ORDER_WEBHOOK_EVENTS.length} ` +
        `actor=${actorUserId ?? 'system'}`,
    );

    // Shoper has no synchronous, verifiable ping, so `testPingTriggered` is false by
    // design - that is not a failure and carries no warning.
    return {
      webhooksConfigured: stateUpdateOk,
      testPingTriggered: false,
      ...(stateUpdateOk ? {} : { warning: 'state-update-failed' }),
    };
  }

  /** `PUT` the webhook already pointing at our endpoint, else `POST` a new one. */
  private async upsert(
    client: ShoperHttpClient,
    endpoint: string,
    body: ShoperWebhookWriteBody,
    connectionId: string,
  ): Promise<void> {
    const ours = (await this.listWebhooks(client)).filter((row) => isOurs(row.url, endpoint));
    if (ours.length === 0) {
      await client.post<unknown>(SHOPER_WEBHOOKS_PATH, body);
      return;
    }
    if (ours.length > 1) {
      // Every duplicate is updated: one left on the rotated-out token would have each
      // delivery rejected and read as an attack on the auth-failing surface (#1814).
      this.logger.warn(
        `Shoper shop of connection ${connectionId} holds ${ours.length} webhooks for ${endpoint}; ` +
          'updating all of them so none keeps the rotated-out token (delete the extras in the shop)',
      );
    }
    for (const row of ours) {
      await client.put(`${SHOPER_WEBHOOKS_PATH}/${String(row.webhook_id)}`, body);
    }
  }

  /** Every webhook of the shop. The `url` filter matches by equality only, so ours is found by listing. */
  private async listWebhooks(client: ShoperHttpClient): Promise<ShoperWebhookRow[]> {
    const rows: ShoperWebhookRow[] = [];
    for (let page = 1; ; page += 1) {
      const result = await fetchShoperPage<ShoperWebhookRow>(client, SHOPER_WEBHOOKS_PATH, {
        page,
        limit: SHOPER_MAX_PAGE_SIZE,
        query: { order: 'webhook_id ASC' },
      });
      rows.push(...result.items);
      if (page >= result.pages) {
        return rows;
      }
    }
  }

  private async markWebhooksUnconfigured(connectionId: string, config: Connection['config']): Promise<void> {
    try {
      await this.connectionPort.update(connectionId, { config: { ...config, webhooksConfigured: false } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Could not flag connection ${connectionId} as webhooks-unconfigured after a registration ` +
          `failure: ${message}. Re-running install is idempotent.`,
      );
    }
  }
}

/** The row's URL IS our endpoint, ignoring the (rotating) query string. */
function isOurs(rowUrl: string | null | undefined, endpoint: string): boolean {
  if (typeof rowUrl !== 'string') {
    return false;
  }
  const withoutQuery = rowUrl.split('?')[0] ?? '';
  return withoutQuery.replace(/\/+$/, '') === endpoint;
}

/** Replaces every occurrence of the secret, raw and URL-encoded, so an echoed delivery URL leaks nothing. */
export function redactSecret(message: string, secret: string): string {
  if (secret.length === 0) {
    return message;
  }
  return [secret, encodeURIComponent(secret)].reduce(
    (text, variant) => text.split(variant).join('[redacted]'),
    message,
  );
}
