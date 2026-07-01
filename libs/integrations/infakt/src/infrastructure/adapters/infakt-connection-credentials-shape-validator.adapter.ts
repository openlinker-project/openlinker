/**
 * Infakt Connection Credentials Shape Validator
 *
 * Validates the credentials payload for an Infakt connection: a required,
 * non-empty `apiKey` string. Registered against
 * `ConnectionCredentialsShapeValidatorRegistryService` at
 * `infakt.accounting.v1`; `ConnectionService` maps the thrown exception to a
 * 400 at the API boundary.
 *
 * Validating shape BEFORE persistence keeps malformed credentials out of the
 * DB so a connection can never reach the adapter factory with an
 * unresolvable credential.
 *
 * Hand-rolled (no class-validator) to stay dependency-light. Error detail
 * never echoes the `apiKey` value.
 *
 * @module libs/integrations/infakt/src/infrastructure/adapters
 * @see {@link ConnectionCredentialsShapeValidatorPort}
 */
import {
  type ConnectionCredentialsShapeValidatorPort,
  InvalidCredentialsShapeException,
} from '@openlinker/core/integrations';

export class InfaktConnectionCredentialsShapeValidatorAdapter
  implements ConnectionCredentialsShapeValidatorPort
{
  constructor(private readonly pluginName: string = 'Infakt') {}

  validate(credentials: Record<string, unknown>): Promise<void> {
    const apiKey = credentials.apiKey;
    if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      return Promise.reject(
        new InvalidCredentialsShapeException(
          this.pluginName,
          'must include a non-empty `apiKey` string',
        ),
      );
    }
    return Promise.resolve();
  }
}
