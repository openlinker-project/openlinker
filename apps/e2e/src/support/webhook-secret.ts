/**
 * Webhook-secret rotation cleanup
 *
 * Every spec that fires a REAL signed inbound webhook has to know the
 * connection's plaintext signing secret, and the only way to learn it is
 * `POST /connections/:id/webhooks/secret/rotate` - which mints a brand-new
 * random secret and returns it once. That call is one-directional: it changes
 * OL's stored secret and pushes NOTHING to the platform
 * (`ConnectionController.rotateWebhookSecret`). The PrestaShop OL module, the
 * WooCommerce webhook records, the InPost registration and the inFakt config
 * all keep signing with the pre-run secret, so from the moment a spec rotates,
 * every genuine delivery fails signature verification and 401s - which per
 * #1814 flips the connection to `activation: 'auth-failing'`. Inbound order
 * ingestion (the low-latency PRIMARY path this suite exists to regression-test)
 * stays dead until an operator re-provisions by hand.
 *
 * `restoreWebhookSecret` is the counterpart every rotating spec owes the stack.
 * It re-runs `POST /connections/:id/webhooks/install`, which is the ONE action
 * that rotates OL's secret and hands the new plaintext to the platform in the
 * same transaction (`PrestashopWebhookProvisioningAdapter.install`,
 * `WooCommerceWebhookProvisioningAdapter.install`), putting the two sides back
 * in agreement. It deliberately does NOT try to restore the exact pre-run
 * secret: rotation is irreversible (OL never reveals a secret twice), so
 * "re-provision both sides with a fresh one" is the only repair available.
 *
 * Not every provider can be repaired this way. OL registers a
 * `WebhookProvisioningPort` only for PrestaShop, WooCommerce and Erli; for
 * InPost and inFakt the install endpoint answers 400, and for a provider whose
 * callback URL the operator never configured it answers 400 too. Those cases
 * are unfixable from inside the suite, so the function fails LOUDLY to stdout
 * rather than silently - a half-rotated secret is exactly the damage this
 * module exists to prevent, and an operator who cannot see it will not fix it.
 *
 * Call it from a `test.afterAll`, never at the end of the test body: a spec
 * that fails mid-way has still rotated the secret, and that is precisely the
 * run whose damage must not be left behind.
 *
 * @module support
 * @see {@link ApiClient.connections.rotateWebhookSecret}
 */
import { ApiError } from '../api/api-error';
import type { ApiClient } from '../api/api-client';

export interface WebhookSecretRestoreResult {
  /** True when OL re-provisioned the platform, so both sides share a secret again. */
  restored: boolean;
  /** Operator-facing explanation of why the repair could not be made. */
  reason: string | null;
}

/**
 * Re-provision a connection whose webhook secret this run rotated, so the
 * platform and OL agree on a signing secret again.
 *
 * Never throws - a cleanup hook must not convert a passing run into a failing
 * one, and a failing run must not lose its real failure behind a teardown
 * error. When the repair is impossible it warns to stdout with the connection
 * id and the reason, so the run's output names the manual follow-up.
 */
export async function restoreWebhookSecret(
  api: ApiClient,
  provider: string,
  connectionId: string,
): Promise<WebhookSecretRestoreResult> {
  let result: WebhookSecretRestoreResult;
  try {
    const install = await api.connections.installWebhooks(connectionId);
    result = install.webhooksConfigured
      ? { restored: true, reason: null }
      : {
          restored: false,
          reason:
            install.warning ??
            'the provisioner answered webhooksConfigured=false without a warning',
        };
  } catch (error) {
    result = {
      restored: false,
      reason:
        error instanceof ApiError
          ? `${error.status} ${JSON.stringify(error.body)}`
          : String(error),
    };
  }

  if (!result.restored) {
    // `console.warn` (not an annotation): a `test.afterAll` hook has no
    // TestInfo to attach to, and stdout is the only channel that still reaches
    // the run's output from teardown. Silence here is the defect being fixed.
    console.warn(
      `[e2e] MANUAL FOLLOW-UP: this run rotated the ${provider} webhook secret on connection ` +
        `${connectionId} and could NOT re-provision it (${result.reason}). The platform still ` +
        'holds the OLD secret, so every genuine inbound delivery will 401 until webhooks are ' +
        're-provisioned by hand ("Configure webhooks" on the connection).',
    );
  }
  return result;
}

/**
 * The annotation a spec pushes the moment it rotates, so the report records the
 * mutation even when the spec later fails and the teardown repair also fails.
 */
export function webhookSecretRotationAnnotation(
  provider: string,
  connectionId: string,
): { type: string; description: string } {
  return {
    type: 'stack-state',
    description:
      `this run rotated the ${provider} webhook secret on connection ${connectionId}; the suite ` +
      're-provisions it on the way out, and warns to stdout when that is not possible for this ' +
      'provider (OL ships a webhook provisioner only for PrestaShop, WooCommerce and Erli)',
  };
}
