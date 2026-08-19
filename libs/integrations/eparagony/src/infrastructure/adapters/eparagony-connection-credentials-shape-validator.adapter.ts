/**
 * eparagony.pl Connection Credentials Shape Validator
 *
 * Validates the credentials payload for an eparagony.pl connection (#586): a
 * required non-empty `clientId` and `clientSecret`, plus an optional
 * `integrationId` which - when supplied - must carry the vendor's
 * `<integration>:<secret>` form.
 *
 * Shape only. "Do these credentials actually authenticate" is
 * `EparagonyConnectionTesterAdapter`'s question, answered against the live
 * token endpoint.
 *
 * No error message ever echoes a submitted value.
 *
 * @module libs/integrations/eparagony/src/infrastructure/adapters
 * @see {@link ConnectionCredentialsShapeValidatorPort}
 */
import {
  type ConnectionCredentialsShapeValidatorPort,
  InvalidCredentialsShapeException,
} from '@openlinker/core/integrations';

export class EparagonyConnectionCredentialsShapeValidatorAdapter
  implements ConnectionCredentialsShapeValidatorPort
{
  constructor(private readonly pluginName: string = 'eparagony.pl') {}

  validate(credentials: Record<string, unknown>): Promise<void> {
    const problems: string[] = [];

    if (!isNonEmptyString(credentials.clientId)) {
      problems.push('a non-empty `clientId` string');
    }
    if (!isNonEmptyString(credentials.clientSecret)) {
      problems.push('a non-empty `clientSecret` string');
    }

    const integrationId = credentials.integrationId;
    if (integrationId !== undefined && integrationId !== null) {
      // The vendor's documented form is `<integration>:<secret>`; a value
      // missing the separator is almost always half of a copy-paste.
      if (!isNonEmptyString(integrationId) || !integrationId.includes(':')) {
        problems.push('an `integrationId` of the form `<integration>:<secret>` when supplied');
      }
    }

    if (problems.length > 0) {
      return Promise.reject(
        new InvalidCredentialsShapeException(
          this.pluginName,
          `must include ${problems.join(', ')}`,
        ),
      );
    }
    return Promise.resolve();
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
