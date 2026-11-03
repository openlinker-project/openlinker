/**
 * Shoper Connection Credentials Shape Validator Adapter
 *
 * Implements `ConnectionCredentialsShapeValidatorPort` for Shoper. Verifies
 * the raw credentials payload carries a non-empty `token` string before it is
 * encrypted and persisted. The token's value is never echoed into the error.
 *
 * Registered with `host.connectionCredentialsShapeValidatorRegistry` via
 * `createShoperPlugin().register(host)`.
 *
 * @module libs/integrations/shoper/src/infrastructure/adapters
 * @implements {ConnectionCredentialsShapeValidatorPort}
 */
import type { ConnectionCredentialsShapeValidatorPort } from '@openlinker/core/integrations';
import { InvalidCredentialsShapeException } from '@openlinker/core/integrations';

export class ShoperConnectionCredentialsShapeValidatorAdapter
  implements ConnectionCredentialsShapeValidatorPort
{
  constructor(private readonly pluginName: string) {}

  validate(credentials: Record<string, unknown>): Promise<void> {
    const { token } = credentials;
    if (typeof token !== 'string' || token.trim().length === 0) {
      return Promise.reject(
        new InvalidCredentialsShapeException(
          this.pluginName,
          'must include a non-empty `token` string (the API token from the shop admin panel)',
        ),
      );
    }
    return Promise.resolve();
  }
}
