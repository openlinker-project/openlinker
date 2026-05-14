/**
 * Default Email Normalizer
 *
 * Identity normalizer returned by `EmailNormalizerRegistryService.resolve`
 * when no platform-specific normalizer is registered for the resolved
 * `adapterKey`. Delegates to the trim+lowercase baseline in
 * `@openlinker/shared/config::normalizeEmail` so the shared baseline stays
 * authoritative for non-marketplace flows.
 *
 * @module libs/core/src/integrations/infrastructure/adapters
 * @see {@link EmailNormalizerPort} for the port interface
 */
import { normalizeEmail } from '@openlinker/shared/config';
import type { EmailNormalizerPort } from '../../domain/ports/email-normalizer.port';

export const DEFAULT_EMAIL_NORMALIZER: EmailNormalizerPort = {
  normalize(email: string): string {
    return normalizeEmail(email);
  },
};
