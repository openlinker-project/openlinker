/**
 * Mirakl Email Normalizer Adapter
 *
 * Normalizes a Mirakl buyer email before core hashes it for customer identity:
 * trim and lowercase only. The address comes from the order additional field
 * `customer-email` (or Mirakl's relay address), with no per-order suffix to
 * strip, so nothing beyond the shared normalization applies.
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 * @implements {EmailNormalizerPort}
 */
import type { EmailNormalizerPort } from '@openlinker/core/integrations';
import { normalizeEmail } from '@openlinker/shared/config';

export class MiraklEmailNormalizerAdapter implements EmailNormalizerPort {
  normalize(email: string): string {
    return normalizeEmail(email);
  }
}
