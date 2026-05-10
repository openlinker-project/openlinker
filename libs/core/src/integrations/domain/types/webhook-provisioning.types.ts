/**
 * Webhook Provisioning Types
 *
 * Result shape returned by `WebhookProvisioningPort.install`. Encodes the
 * accept-and-surface failure-mode policy: the install endpoint returns 200
 * even on partial-success states, with the warning field naming the
 * specific degraded outcome so operators can see and act on it. The two
 * boolean fields plus the optional warning is the cross-platform contract;
 * any new platform implementing webhook auto-provisioning produces the
 * same shape regardless of its underlying mechanism (#583).
 *
 * @module libs/core/src/integrations/domain/types
 */

export interface WebhookProvisioningResult {
  /**
   * Whether the configuration push to the destination platform succeeded
   * *and* OL recorded `webhooksConfigured: true` on the connection. False
   * on any failure before the state update; true even if the post-config
   * test ping fails.
   */
  webhooksConfigured: boolean;

  /**
   * Whether the synchronous test-ping round-trip succeeded. False if the
   * platform's ping endpoint is unreachable, returns non-2xx, or the
   * resulting webhook delivery to OL fails. Configuration is still valid
   * in this case — webhooks will work for real platform events.
   */
  testPingTriggered: boolean;

  /**
   * Operator-actionable warning attached to partial-success states.
   * Populated when `webhooksConfigured` and `testPingTriggered` disagree
   * with the happy path. Empty when both are `true`.
   */
  warning?: string;
}
