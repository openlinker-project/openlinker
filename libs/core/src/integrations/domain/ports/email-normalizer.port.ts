/**
 * Email Normalizer Port
 *
 * Capability contract for translating a customer-supplied email address into
 * the stable identity form a marketplace uses for buyer-deduplication hashing.
 * Default semantics are trim + lowercase; marketplaces with masked-email
 * formats (Allegro's `fixedPart+transactionId@allegromail.*`, hypothetical
 * eBay/Amazon equivalents) override to strip the transaction-volatile portion.
 *
 * Registered per-adapter in `EmailNormalizerRegistryService`, mirroring
 * `WebhookProvisioningPort` (#583) / `ConnectionTesterPort` — keeps
 * `libs/shared/src/config/pii-hashing.ts` and `libs/core/src/customers`
 * platform-agnostic (#585 / E5).
 *
 * @module libs/core/src/integrations/domain/ports
 */
export interface EmailNormalizerPort {
  /**
   * Return the platform-stable form of `email` used for identity hashing.
   * Implementations must be idempotent: `normalize(normalize(x)) === normalize(x)`.
   */
  normalize(email: string): string;
}
