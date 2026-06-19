/**
 * Erli Connection Credentials Shape Validator
 *
 * Validates the credentials payload for an Erli connection: a single non-empty
 * `apiKey` string (ADR-025 static bearer key). Registered against
 * `ConnectionCredentialsShapeValidatorRegistryService` at `erli.shopapi.v1`;
 * `ConnectionService` maps the thrown exception to a 400 at the API boundary.
 *
 * Hand-rolled (no class-validator) like the PrestaShop credentials validator —
 * one required field doesn't justify a DTO graph, and Erli stays
 * dependency-light.
 *
 * @module libs/integrations/erli/src/infrastructure/adapters
 * @see {@link ConnectionCredentialsShapeValidatorPort}
 */
import {
  type ConnectionCredentialsShapeValidatorPort,
  InvalidCredentialsShapeException,
} from '@openlinker/core/integrations';

export class ErliConnectionCredentialsShapeValidatorAdapter
  implements ConnectionCredentialsShapeValidatorPort
{
  constructor(private readonly pluginName: string = 'Erli') {}

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
