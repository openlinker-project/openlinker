/**
 * Erli Webhook Provisioning Adapter (#996)
 *
 * Implements `WebhookProvisioningPort` for the Erli marketplace. Resolved
 * per-connection by `ConnectionService.installWebhooks` via the
 * `WebhookProvisioningRegistryService` indexed by `adapterKey`.
 *
 * Automated registration (verified against the live Erli Shop API, #992): for
 * each order-relevant hook (`orderCreated`, `orderStatusChanged`) the adapter
 * issues `PUT /hooks/{hookName}` with `{ url, accessToken }`, where:
 *   - `url` = `<connection.config.callbackBaseUrl>/webhooks/erli/<connectionId>`
 *     (where OL receives the inbound trigger), and
 *   - `accessToken` = the connection's rotated webhook secret — the shared
 *     secret Erli echoes back on each delivery for signature verification.
 *
 * Failure posture: a missing `callbackBaseUrl` fails closed with a clear,
 * operator-actionable message (the operator sets it on the connection-edit page
 * first). A `PUT` failure surfaces a retry-safe message; the secret was already
 * rotated OL-side, so re-running install is safe (PUT is idempotent). The #993
 * inbox poll remains the reconciliation backstop regardless.
 *
 * Security: the rotated secret is sent ONLY in the request body — never logged.
 *
 * @module libs/integrations/erli/src/infrastructure/adapters
 * @see {@link WebhookProvisioningPort} for the port interface
 */
import { Logger } from '@openlinker/shared/logging';
import type { ConnectionPort } from '@openlinker/core/identifier-mapping';
import type {
  CredentialsResolverPort,
  IWebhookSecretService,
  WebhookProvisioningPort,
  WebhookProvisioningResult,
} from '@openlinker/core/integrations';
import { ErliAdapterFactory } from '../../application/erli-adapter.factory';
import type { IErliAdapterFactory } from '../../application/interfaces/erli-adapter.factory.interface';
import type { ErliConnectionConfig } from '../../domain/types/erli-connection.types';
import { ErliConfigException } from '../../domain/exceptions/erli-config.exception';
import { ErliWebhookEventTypeValues } from './erli-webhook.types';
import { erliHookPath, type ErliHookRegistrationBody } from './erli-webhook.types';

/** Webhook-secret provider key for Erli connections. */
const ERLI_WEBHOOK_PROVIDER = 'erli';

export class ErliWebhookProvisioningAdapter implements WebhookProvisioningPort {
  private readonly logger = new Logger(ErliWebhookProvisioningAdapter.name);

  constructor(
    private readonly connectionPort: ConnectionPort,
    private readonly webhookSecretService: IWebhookSecretService,
    private readonly credentialsResolver: CredentialsResolverPort,
    // Construction seam — defaults to the concrete factory; injectable for tests.
    private readonly factory: IErliAdapterFactory = new ErliAdapterFactory(),
  ) {}

  async install(connectionId: string, actorUserId?: string): Promise<WebhookProvisioningResult> {
    // Routing by adapterKey guarantees this adapter only sees Erli connections;
    // the unsupported-platform 400 lives in `ConnectionService.installWebhooks`.
    const connection = await this.connectionPort.get(connectionId);
    const config = (connection.config ?? {}) as ErliConnectionConfig;

    const callbackBaseUrl = config.callbackBaseUrl?.trim();
    if (!callbackBaseUrl) {
      throw new ErliConfigException(
        'Set the OL callback base URL on the connection-edit page before configuring ' +
          'webhooks (e.g. http://host.docker.internal:3000 in dev, your public OL URL in ' +
          'prod) — Erli needs to know where to POST events back to OL.',
        connectionId,
      );
    }

    // Rotate the shared secret (one-shot plaintext). Erli echoes it back on each
    // delivery for signature verification; it is sent only in the PUT body below.
    const { secret } = await this.webhookSecretService.rotate(
      ERLI_WEBHOOK_PROVIDER,
      connectionId,
      actorUserId,
    );

    const httpClient = await this.factory.createHttpClient(connection, this.credentialsResolver);
    const url = `${callbackBaseUrl.replace(/\/$/, '')}/webhooks/erli/${connectionId}`;
    const body: ErliHookRegistrationBody = { url, accessToken: secret };

    try {
      for (const hookName of ErliWebhookEventTypeValues) {
        // PUT is idempotent — re-registering a hook overwrites its config.
        await httpClient.put(erliHookPath(hookName), body, { idempotent: true });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to register Erli webhooks for connection ${connectionId}: ${message}`,
      );
      throw new ErliConfigException(
        `Erli webhook registration failed: ${message}. The secret was rotated OL-side; ` +
          're-running install is safe (PUT is idempotent).',
        connectionId,
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
        `Erli webhooks registered but the connection state update failed for ${connectionId}: ` +
          `${message}. Erli has the right config; re-running install is idempotent.`,
      );
    }

    this.logger.log(
      `Erli webhooks registered for connection ${connectionId} ` +
        `(${ErliWebhookEventTypeValues.length} hooks${stateUpdateOk ? '' : '; state update pending'}).`,
    );

    return {
      webhooksConfigured: true,
      testPingTriggered: false,
      ...(stateUpdateOk ? {} : { warning: 'state-update-failed' }),
    };
  }
}
