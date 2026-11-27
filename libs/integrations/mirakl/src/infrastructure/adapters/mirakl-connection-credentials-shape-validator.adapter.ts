/**
 * Mirakl Connection Credentials Shape Validator
 *
 * A Mirakl connection's credentials are one non-empty `apiKey` string, the
 * shop key from the operator back office. Hand-rolled like the Erli validator;
 * `ConnectionService` maps the thrown exception to a 400.
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 * @see {@link ConnectionCredentialsShapeValidatorPort}
 */
import {
  type ConnectionCredentialsShapeValidatorPort,
  InvalidCredentialsShapeException,
} from '@openlinker/core/integrations';

export class MiraklConnectionCredentialsShapeValidatorAdapter
  implements ConnectionCredentialsShapeValidatorPort
{
  constructor(private readonly brand: string) {}

  validate(credentials: Record<string, unknown>): Promise<void> {
    const apiKey = credentials.apiKey;
    if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      return Promise.reject(
        new InvalidCredentialsShapeException(this.brand, 'must include a non-empty `apiKey` string'),
      );
    }
    return Promise.resolve();
  }
}
