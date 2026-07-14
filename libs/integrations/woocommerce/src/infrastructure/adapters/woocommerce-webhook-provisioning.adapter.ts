/**
 * WooCommerce Webhook Provisioning Adapter (#1548)
 *
 * Implements `WebhookProvisioningPort` for the WooCommerce platform — registers
 * the store-side order webhooks through WooCommerce REST v3
 * (`POST /wp-json/wc/v3/webhooks`), each pointing at OpenLinker's inbound
 * ingress (`/webhooks/woocommerce/:connectionId`). Resolved per-connection by
 * `ConnectionService.installWebhooks` via `WebhookProvisioningRegistryService`
 * indexed by `adapterKey`; self-registers from `WooCommerceWebhookProvisioningModule`
 * (it needs the NestJS-injected `ConnectionPort` + `IWebhookSecretService`, which
 * are deliberately NOT part of the framework-neutral `HostServices` bag).
 *
 * Flow (mirrors the PrestaShop / Erli provisioners):
 *   1. Validate connection config (callback base URL set, siteUrl set).
 *   2. Rotate the connection's webhook secret (one-shot plaintext) and hand it
 *      to WooCommerce as each webhook's `secret` — WC signs every delivery with
 *      a base64 HMAC-SHA256 of the raw body keyed by this secret.
 *   3. Upsert one webhook per order topic (`order.created`, `order.updated`),
 *      idempotently: an existing webhook matching topic + delivery_url is PUT
 *      (secret rotated, status re-activated); otherwise a new one is POSTed.
 *   4. Mark `connection.config.webhooksConfigured = true`.
 *
 * SIGNATURE VERIFICATION DELTA (#1548 acceptance criterion 4): WooCommerce signs
 * inbound deliveries with `X-WC-Webhook-Signature: <base64(HMAC-SHA256(rawBody))>`
 * and sends NO signed timestamp header. The host's default inbound decoder
 * (`DefaultWebhookDecoder`) expects OpenLinker's own scheme
 * (`X-OpenLinker-Timestamp` + `X-OpenLinker-Signature = sha256=<hex>` over
 * `timestamp.body`). The two are incompatible, so end-to-end inbound
 * authentication requires a WooCommerce-specific `InboundWebhookDecoderPort`
 * (the ADR-021 seam, exactly like `ErliInboundWebhookDecoderAdapter`) that
 * verifies the base64 signature and omits the replay-timestamp. That decoder is
 * a scoped follow-up; this adapter provisions the store side so the decoder can
 * verify against the same rotated secret when it lands. Until then the
 * `WooCommerceOrderSourceAdapter` poll remains the reconciliation backstop.
 *
 * TEST PING: WooCommerce has no synchronous, verifiable test-ping round-trip
 * (its own "ping" on webhook creation is delivered asynchronously and cannot be
 * observed inside this call), so `testPingTriggered` is always `false` by design
 * — not a degraded state. No warning is attached on the happy path.
 *
 * Failure-mode policy: accept-and-surface. Hard validation fails closed
 * (`BadRequestException`); a partial state after a successful push returns a
 * `warning`.
 *
 * Security: the rotated secret is sent ONLY in the WC request body — never logged.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters
 * @implements {WebhookProvisioningPort}
 * @see {@link WooCommerceWebhookEventTranslatorAdapter} for the downstream translator
 */
import { BadRequestException } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import type { ConnectionPort } from '@openlinker/core/identifier-mapping';
import type {
  CredentialsResolverPort,
  IWebhookSecretService,
  WebhookProvisioningPort,
  WebhookProvisioningResult,
} from '@openlinker/core/integrations';
import type { WooCommerceConnectionConfig } from '../../domain/types/woocommerce-config.types';
import type { WooCommerceCredentials } from '../../domain/types/woocommerce-credentials.types';
import { WooCommerceHttpClient } from '../http/woocommerce-http-client';
import type { IWooCommerceHttpClient } from '../http/woocommerce-http-client.interface';
import {
  WOOCOMMERCE_ORDER_WEBHOOK_TOPICS,
  WOOCOMMERCE_WEBHOOK_PROVIDER,
  WOOCOMMERCE_WEBHOOKS_PATH,
  type WooCommerceOrderWebhookTopic,
  type WooCommerceWebhookResource,
  type WooCommerceWebhookWriteBody,
} from './woocommerce-webhook.types';

/** Upper bound on the existing-webhook listing used for idempotent upserts. */
const WEBHOOK_LIST_PAGE_SIZE = 100;

export class WooCommerceWebhookProvisioningAdapter implements WebhookProvisioningPort {
  private readonly logger = new Logger(WooCommerceWebhookProvisioningAdapter.name);

  constructor(
    private readonly connectionPort: ConnectionPort,
    private readonly webhookSecretService: IWebhookSecretService,
    private readonly credentialsResolver: CredentialsResolverPort,
  ) {}

  async install(connectionId: string, actorUserId?: string): Promise<WebhookProvisioningResult> {
    // Routing by adapterKey guarantees this adapter only sees WooCommerce
    // connections; the unsupported-platform 400 lives in
    // `ConnectionService.installWebhooks`.
    const connection = await this.connectionPort.get(connectionId);
    const config = (connection.config ?? {}) as Partial<WooCommerceConnectionConfig>;

    const callbackBaseUrl = config.openlinkerCallbackBaseUrl?.trim();
    if (!callbackBaseUrl) {
      throw new BadRequestException(
        'Set the OL callback URL on the connection-edit page before configuring webhooks. ' +
          'WooCommerce needs to know where to POST events back to OL ' +
          '(e.g. http://host.docker.internal:3000 in dev, your public OL URL in prod).',
      );
    }

    if (!config.siteUrl || typeof config.siteUrl !== 'string') {
      // Defensive — should be caught by the config-shape DTO at save time.
      throw new BadRequestException(`Connection ${connectionId} is missing siteUrl in config.`);
    }

    // Rotate the shared secret (one-shot plaintext). WooCommerce signs each
    // delivery with it; it is sent only in the WC webhook body below.
    const { secret } = await this.webhookSecretService.rotate(
      WOOCOMMERCE_WEBHOOK_PROVIDER,
      connectionId,
      actorUserId,
    );

    const httpClient = await this.createHttpClient(connection.credentialsRef, config.siteUrl);
    const deliveryUrl = `${callbackBaseUrl.replace(/\/$/, '')}/webhooks/${WOOCOMMERCE_WEBHOOK_PROVIDER}/${connectionId}`;

    try {
      const existing = await this.listWebhooks(httpClient);
      for (const topic of WOOCOMMERCE_ORDER_WEBHOOK_TOPICS) {
        await this.upsertWebhook(httpClient, existing, topic, deliveryUrl, secret, connectionId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to register WooCommerce webhooks for connection ${connectionId}: ${message}`,
      );
      throw new BadRequestException(
        `WooCommerce webhook registration failed: ${message}. The webhook secret was rotated ` +
          "on OL's side; re-running install is safe (registration is idempotent).",
      );
    }

    // Record success on the connection (best-effort; re-running install is safe).
    let stateUpdateOk = true;
    try {
      await this.connectionPort.update(connectionId, {
        config: { ...connection.config, webhooksConfigured: true },
      });
    } catch (error) {
      stateUpdateOk = false;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `WooCommerce webhooks registered but the connection state update failed for ` +
          `${connectionId}: ${message}. WC has the right config; re-running install is idempotent.`,
      );
    }

    this.logger.log(
      `webhook_install.completed connectionId=${connectionId} provider=woocommerce ` +
        `webhooksConfigured=${stateUpdateOk} topics=${WOOCOMMERCE_ORDER_WEBHOOK_TOPICS.length} ` +
        `actor=${actorUserId ?? 'system'}`,
    );

    // testPingTriggered is always false for WooCommerce (no synchronous,
    // verifiable ping — see the module doc); it is not a failure, so no warning.
    return {
      webhooksConfigured: stateUpdateOk,
      testPingTriggered: false,
      ...(stateUpdateOk ? {} : { warning: 'state-update-failed' }),
    };
  }

  /**
   * List the store's existing webhooks (single page — a store legitimately
   * carrying >100 webhooks is out of scope; the upsert simply creates a new one
   * if a match isn't on the first page, which WC tolerates).
   */
  private async listWebhooks(
    httpClient: IWooCommerceHttpClient,
  ): Promise<WooCommerceWebhookResource[]> {
    return httpClient.get<WooCommerceWebhookResource[]>(WOOCOMMERCE_WEBHOOKS_PATH, {
      per_page: WEBHOOK_LIST_PAGE_SIZE,
    });
  }

  /**
   * Upsert one webhook by (topic + delivery_url): PUT an existing match (rotates
   * the secret, re-activates it) or POST a new one. Matching on delivery_url
   * keeps re-runs from stacking duplicate webhooks on the store.
   */
  private async upsertWebhook(
    httpClient: IWooCommerceHttpClient,
    existing: WooCommerceWebhookResource[],
    topic: WooCommerceOrderWebhookTopic,
    deliveryUrl: string,
    secret: string,
    connectionId: string,
  ): Promise<void> {
    const body: WooCommerceWebhookWriteBody = {
      name: `OpenLinker ${topic} (connection ${connectionId})`,
      topic,
      delivery_url: deliveryUrl,
      secret,
      status: 'active',
    };

    const match = existing.find((w) => w.topic === topic && w.delivery_url === deliveryUrl);
    if (match) {
      await httpClient.put(`${WOOCOMMERCE_WEBHOOKS_PATH}/${match.id}`, body);
      return;
    }
    await httpClient.post(WOOCOMMERCE_WEBHOOKS_PATH, body);
  }

  private async createHttpClient(
    credentialsRef: string,
    siteUrl: string,
  ): Promise<IWooCommerceHttpClient> {
    const credentials = await this.credentialsResolver.get<WooCommerceCredentials>(credentialsRef);
    return new WooCommerceHttpClient(siteUrl, credentials.consumerKey, credentials.consumerSecret);
  }
}
