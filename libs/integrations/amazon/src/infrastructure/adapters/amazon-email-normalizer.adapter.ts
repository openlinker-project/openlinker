/**
 * Amazon Email Normalizer
 *
 * Amazon hands the seller an anonymized relay address per buyer
 * (`...@marketplace.amazon.<tld>`), stable for one buyer and seller, so the
 * baseline normalisation (trim, lowercase) is all it needs. Registered so the
 * identity resolver treats Amazon as its own identity origin rather than
 * guessing at a pattern it does not have.
 *
 * @module libs/integrations/amazon/src/infrastructure/adapters
 * @implements {EmailNormalizerPort}
 */
import type { EmailNormalizerPort } from '@openlinker/core/integrations';
import { normalizeEmail } from '@openlinker/shared/config';

export class AmazonEmailNormalizerAdapter implements EmailNormalizerPort {
  normalize(email: string): string {
    return normalizeEmail(email);
  }
}
