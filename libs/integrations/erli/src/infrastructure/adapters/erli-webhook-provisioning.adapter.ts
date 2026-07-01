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
 * first). A `PUT` failure surfaces a retry-safe message AND best-effort flips the
 * persisted `webhooksConfigured` flag to false (so a prior `true` doesn't go
 * stale and the connection-actions UI shows webhooks are NOT live) — the secret
 * was already rotated OL-side, so re-running install is safe (PUT is idempotent).
 * The #993 inbox poll remains the reconciliation backstop regardless.
 *
 * Security: the rotated secret is sent ONLY in the request body — never logged.
 *
 * @module libs/integrations/erli/src/infrastructure/adapters
 * @see {@link WebhookProvisioningPort} for the port interface
 */
import { Logger } from '@openlinker/shared/logging';
import type { Connection, ConnectionPort } from '@openlinker/core/identifier-mapping';
import type {
  CredentialsResolverPort,
  IWebhookSecretService,
  WebhookProvisioningPort,
  WebhookProvisioningResult,
} from '@openlinker/core/integrations';
import type { IErliAdapterFactory } from '../../application/interfaces/erli-adapter.factory.interface';
import type { ErliConnectionConfig } from '../../domain/types/erli-connection.types';
import { ErliConfigException } from '../../domain/exceptions/erli-config.exception';
import { ErliWebhookEventTypeValues } from './erli-webhook.types';
import { erliHookPath, type ErliHookRegistrationBody } from './erli-webhook.types';

/** Webhook-secret provider key for Erli connections. */
const ERLI_WEBHOOK_PROVIDER = 'erli';

// Same-process loopback call to OL's own ingress — a short bound is enough,
// and it keeps a hung self-test from blocking the admin-facing `install()`
// call (mirrors the AbortController timeout pattern in `erli-http-client.ts`).
const SELF_TEST_TIMEOUT_MS = 5_000;

export class ErliWebhookProvisioningAdapter implements WebhookProvisioningPort {
  private readonly logger = new Logger(ErliWebhookProvisioningAdapter.name);

  constructor(
    private readonly connectionPort: ConnectionPort,
    private readonly webhookSecretService: IWebhookSecretService,
    private readonly credentialsResolver: CredentialsResolverPort,
    // Injected from the composition root (`ErliWebhookProvisioningModule`); no
    // in-constructor `new` so the dependency stays explicit (and fakeable in tests).
    private readonly factory: IErliAdapterFactory,
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

    try {
      for (const hookName of ErliWebhookEventTypeValues) {
        // Erli's HookSave requires `hookName` in the body (not just the path) and
        // rejects unknown properties — so the body repeats the path hook name.
        const body: ErliHookRegistrationBody = { hookName, url, accessToken: secret };
        // PUT is idempotent — re-registering a hook overwrites its config.
        await httpClient.put(erliHookPath(hookName), body, { idempotent: true });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to register Erli webhooks for connection ${connectionId}: ${message}`,
      );
      // Fail-closed visibility: the secret was already rotated OL-side, but Erli
      // may still hold the old/no secret, so inbound signature verification stays
      // broken until install is re-run. Best-effort flip the persisted
      // `webhooksConfigured` flag to false so the operator SEES webhooks are not
      // live (the connection-actions UI badge) and re-runs — rather than a prior
      // `true` going stale. The #993 inbox poll still backstops order loss.
      await this.markWebhooksUnconfigured(connectionId, connection.config);
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

    const testPingTriggered = await this.selfTestPing(url, secret, connectionId);

    return {
      webhooksConfigured: true,
      testPingTriggered,
      ...(stateUpdateOk ? {} : { warning: 'state-update-failed' }),
    };
  }

  /**
   * Round-trips the just-registered secret against OL's OWN webhook endpoint,
   * in the exact shape Erli uses (`Authorization: Bearer <secret>`) — proving
   * the ingress accepts it without waiting for Erli to actually deliver
   * anything (Erli's own delivery latency in the sandbox has been observed
   * to range from seconds to 15+ minutes with no visible pattern, which makes
   * "did the fix work" otherwise unanswerable on any predictable timeline).
   *
   * The body is intentionally empty: an authentic signature always reaches
   * `extractEnvelope`, which then rejects it (400, missing order id) — so a
   * successful self-test never enqueues a real `marketplace.order.sync` job.
   * Only 2xx or 400 count as "signature accepted" — those are the only two
   * outcomes reachable once `verify()` passes (route, or reject on the empty
   * body); any other status (401 = signature rejected, 5xx = ingress error,
   * a timeout, …) is treated as "not triggered" rather than mistaking a
   * transient failure for a working signature. The secret is never logged,
   * only used in-memory for this one request.
   *
   * Bounded by `SELF_TEST_TIMEOUT_MS`: a hung or unreachable OL ingress must
   * degrade to `testPingTriggered: false`, never block the caller — `install()`
   * already succeeded by the time this runs, and the docstring's "non-fatal"
   * promise only holds if a stalled request can't stall the response too.
   */
  private async selfTestPing(
    url: string,
    secret: string,
    connectionId: string,
  ): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SELF_TEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
        body: '{}',
        signal: controller.signal,
      });
      const ok = response.status === 400 || (response.status >= 200 && response.status < 300);
      this.logger.log(
        `Erli webhook self-test ping for connection ${connectionId}: HTTP ${response.status} ` +
          `(signature ${ok ? 'accepted' : 'REJECTED'}).`,
      );
      return ok;
    } catch (error) {
      const timedOut = controller.signal.aborted || (error as Error)?.name === 'AbortError';
      const message = timedOut
        ? `timed out after ${SELF_TEST_TIMEOUT_MS}ms`
        : error instanceof Error
          ? error.message
          : String(error);
      this.logger.warn(
        `Erli webhook self-test ping failed for connection ${connectionId} (non-fatal — ` +
          `install already succeeded): ${message}`,
      );
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Best-effort flip of the persisted `webhooksConfigured` flag to false after a
   * failed registration. Swallows its own errors so it never masks the original
   * registration failure — the caller still throws the actionable message.
   */
  private async markWebhooksUnconfigured(
    connectionId: string,
    config: Connection['config'],
  ): Promise<void> {
    try {
      await this.connectionPort.update(connectionId, {
        config: { ...config, webhooksConfigured: false },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Could not flag connection ${connectionId} as webhooks-unconfigured after a ` +
          `registration failure: ${message}. Re-running install is idempotent.`,
      );
    }
  }
}
