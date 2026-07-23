/**
 * Webhook Secret Types
 *
 * Platform allowlist for the caller-supplied `WebhookSecretService.set` path
 * (#1770 review). Every other platform's webhook secret is server-rotated
 * only (`rotate`) - `set` exists solely for platforms that mint the secret
 * themselves and hand it to the operator to paste back in (inFakt has no
 * webhook-provisioning API and no way to accept an OL-generated secret).
 *
 * This is a platform-name literal allowlist today because inFakt is the only
 * platform that needs the caller-supplied path, and a hardcoded list keeps the
 * blast radius tiny (precedent: `TaxonomyOwnerValues` in listings). The future
 * direction, once a second platform needs this, is an adapter-declared
 * capability (e.g. `CallerSuppliedWebhookSecretProvider`) resolved via the
 * registry, so no platform name lives in CORE - matching the capability-driven
 * dispatch model in `docs/architecture-overview.md`.
 *
 * @module libs/core/src/integrations/domain/types
 */

export const CALLER_SUPPLIED_WEBHOOK_SECRET_PLATFORMS = ['infakt'] as const;

export type CallerSuppliedWebhookSecretPlatform =
  (typeof CALLER_SUPPLIED_WEBHOOK_SECRET_PLATFORMS)[number];

export function acceptsCallerSuppliedWebhookSecret(platformType: string): boolean {
  return (CALLER_SUPPLIED_WEBHOOK_SECRET_PLATFORMS as readonly string[]).includes(platformType);
}
