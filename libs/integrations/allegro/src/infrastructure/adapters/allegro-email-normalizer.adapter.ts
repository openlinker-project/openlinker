/**
 * Allegro Email Normalizer Adapter
 *
 * Implements `EmailNormalizerPort` for the Allegro marketplace. Allegro
 * delivers buyer email in a masked form — `fixedPart+transactionId@allegromail.*`
 * — where the transactionId rotates per order while the fixedPart is stable
 * per buyer. For OpenLinker's `emailHash`-based customer-identity dedup to
 * work, the volatile suffix must be stripped before hashing.
 *
 * Previously this rule lived inside `@openlinker/shared/config::normalizeEmail`
 * gated on the `@allegromail.` domain check, which leaked Allegro semantics
 * into the platform-agnostic shared package and CORE customer-identity
 * service (#585 / E5). Self-registered against
 * `EmailNormalizerRegistryService` at boot via
 * `AllegroIntegrationModule.onModuleInit` so CORE stays platform-clean.
 *
 * @module libs/integrations/allegro/src/infrastructure/adapters
 * @see {@link EmailNormalizerPort} for the port interface
 */
import type { EmailNormalizerPort } from '@openlinker/core/integrations';
import { normalizeEmail } from '@openlinker/shared/config';

export class AllegroEmailNormalizerAdapter implements EmailNormalizerPort {
  normalize(email: string): string {
    const baseline = normalizeEmail(email);
    if (!baseline || !baseline.includes('@allegromail.')) {
      return baseline;
    }
    const [localPart, domain] = baseline.split('@');
    if (!localPart.includes('+')) {
      return baseline;
    }
    const stablePart = localPart.split('+')[0];
    return `${stablePart}@${domain}`;
  }
}
