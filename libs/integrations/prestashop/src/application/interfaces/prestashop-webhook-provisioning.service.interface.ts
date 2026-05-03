/**
 * PrestaShop Webhook Provisioning Service Interface
 *
 * Defines the contract for auto-provisioning a PrestaShop connection's
 * webhook configuration in the `openlinker` PS module without operator
 * copy-paste (#168). Eliminates the manual flow of pasting Base URL +
 * Connection ID + Webhook Secret into the PS admin module form.
 *
 * @module libs/integrations/prestashop/src/application/interfaces
 */

export const PRESTASHOP_WEBHOOK_PROVISIONING_SERVICE_TOKEN = Symbol(
  'IPrestashopWebhookProvisioningService',
);

export interface InstallWebhooksResult {
  /**
   * Whether the configuration push to PS via WS succeeded *and* OL recorded
   * `webhooksConfigured: true` on the connection. False on any failure
   * before the state update; true even if the post-config test ping fails.
   */
  webhooksConfigured: boolean;

  /**
   * Whether the synchronous test ping round-trip succeeded. False if the
   * PS module's ping endpoint is unreachable, returns non-2xx, or the
   * subsequent webhook delivery to OL fails. Configuration is still valid
   * in this case — webhooks will work for real PS events.
   */
  testPingTriggered: boolean;

  /**
   * Operator-actionable warning attached to partial-success states.
   * Populated when `webhooksConfigured` and `testPingTriggered` disagree
   * with the happy path. Empty when both are `true`.
   */
  warning?: string;
}

export interface IPrestashopWebhookProvisioningService {
  /**
   * Install webhook configuration on the PS `openlinker` module via PS WS.
   *
   * Side effects (in order):
   *   1. Rotates the connection's webhook secret (existing
   *      `WebhookSecretService.rotate`).
   *   2. Pushes Base URL / Connection ID / Webhook Secret to PS via
   *      `PUT /api/configurations` (built-in PS WS resource).
   *   3. Marks `connection.config.webhooksConfigured = true`.
   *   4. POSTs a HMAC-signed `test_ping` trigger to the module's
   *      `controllers/front/ping.php` so a synchronous round-trip
   *      verification arrives at OL within ~2 seconds.
   *
   * Failure modes (accept-and-surface):
   *   - Step 2 fails → throws; secret has been rotated but PS still has
   *     the old one. Operator retries.
   *   - Step 3 fails → returns warning='state-update-failed'; PS has the
   *     right config but OL didn't record success. Re-running install is
   *     safe.
   *   - Step 4 fails → returns warning='ping-not-received'; configuration
   *     is correct, verification just didn't complete.
   *
   * @param connectionId PrestaShop connection id
   * @param actorUserId  Optional acting user (forwarded to the secret service)
   * @throws BadRequestException if the connection is non-prestashop or its
   *         `config.openlinkerCallbackBaseUrl` is unset.
   */
  install(
    connectionId: string,
    actorUserId?: string,
  ): Promise<InstallWebhooksResult>;
}
