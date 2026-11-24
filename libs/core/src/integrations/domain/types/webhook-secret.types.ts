/**
 * Webhook Secret Types (deprecated)
 *
 * Kept only so out-of-tree plugins compiled against the public
 * `@openlinker/core/integrations` barrel keep resolving these names. Core logic no longer
 * consults a platform-name list: whether a connection accepts a caller-supplied
 * webhook secret is declared by the adapter via
 * `AdapterMetadata.acceptsCallerSuppliedWebhookSecret` (#3981).
 *
 * @module libs/core/src/integrations/domain/types
 */

/** @deprecated Declare `acceptsCallerSuppliedWebhookSecret` on the adapter manifest instead; core no longer reads this list. */
export const CALLER_SUPPLIED_WEBHOOK_SECRET_PLATFORMS = ['infakt'] as const;

/** @deprecated See {@link CALLER_SUPPLIED_WEBHOOK_SECRET_PLATFORMS}. */
export type CallerSuppliedWebhookSecretPlatform =
  (typeof CALLER_SUPPLIED_WEBHOOK_SECRET_PLATFORMS)[number];

/** @deprecated Use `resolveAcceptsCallerSuppliedWebhookSecret(metadata)`; this static check is not used by core. */
export function acceptsCallerSuppliedWebhookSecret(platformType: string): boolean {
  return (CALLER_SUPPLIED_WEBHOOK_SECRET_PLATFORMS as readonly string[]).includes(platformType);
}
