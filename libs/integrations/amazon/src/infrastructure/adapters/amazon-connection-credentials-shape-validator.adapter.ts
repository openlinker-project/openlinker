/**
 * Amazon Connection Credentials Shape Validator
 *
 * Refuses, at save time, credentials the token provider could not use: a
 * missing `clientId`, `clientSecret` or `refreshToken`, or an unknown
 * `source`. Same reader as the token provider (`parseAmazonCredentials`).
 * Never echoes a value back.
 *
 * @module libs/integrations/amazon/src/infrastructure/adapters
 * @implements {ConnectionCredentialsShapeValidatorPort}
 */
import {
  type ConnectionCredentialsShapeValidatorPort,
  InvalidCredentialsShapeException,
} from '@openlinker/core/integrations';

import { parseAmazonCredentials } from '../../domain/policies/amazon-credentials.policy';

export class AmazonConnectionCredentialsShapeValidatorAdapter implements ConnectionCredentialsShapeValidatorPort {
  constructor(private readonly pluginName: string = 'Amazon') {}

  validate(credentials: Record<string, unknown>): Promise<void> {
    const parsed = parseAmazonCredentials(credentials);
    if (parsed.ok) {
      return Promise.resolve();
    }
    return Promise.reject(new InvalidCredentialsShapeException(this.pluginName, parsed.issues.join('; ')));
  }
}
