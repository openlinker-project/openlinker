/**
 * KSeF Connection Credentials Shape Validator
 *
 * Validates the credentials payload for a KSeF connection: an `authType`
 * selecting the authentication mode (`ksef-token` | `qualified-seal`) and a
 * non-empty opaque `secretRef`. The `secretRef` is a reference resolved at
 * adapter construction (C3) via the host `CredentialsResolverPort` — never the
 * secret value itself, so the validator checks only that it is present and
 * non-empty and NEVER echoes its value. Registered against
 * `ConnectionCredentialsShapeValidatorRegistryService` at `ksef.publicapi.v2`;
 * `ConnectionService` maps the thrown exception to a 400 at the API boundary.
 *
 * Validating shape BEFORE persistence keeps malformed credentials out of the
 * DB so a connection can never reach C3 with an unresolvable credential.
 *
 * Hand-rolled (no class-validator) to stay dependency-light. Error detail uses
 * neutral terminology only (no Polish tax vocabulary) and never includes the
 * `secretRef` value.
 *
 * @module libs/integrations/ksef/src/infrastructure/adapters
 * @see {@link ConnectionCredentialsShapeValidatorPort}
 */
import {
  type ConnectionCredentialsShapeValidatorPort,
  InvalidCredentialsShapeException,
} from '@openlinker/core/integrations';
import { KsefAuthTypeValues } from '../../domain/types/ksef-connection.types';

export class KsefConnectionCredentialsShapeValidatorAdapter
  implements ConnectionCredentialsShapeValidatorPort
{
  constructor(private readonly pluginName: string = 'KSeF') {}

  validate(credentials: Record<string, unknown>): Promise<void> {
    const authType = credentials.authType;
    if (typeof authType !== 'string' || authType.trim().length === 0) {
      return this.reject('must include a non-empty `authType` string');
    }
    if (!(KsefAuthTypeValues as readonly string[]).includes(authType)) {
      return this.reject(`authType must be one of: ${KsefAuthTypeValues.join(', ')}`);
    }

    const secretRef = credentials.secretRef;
    if (typeof secretRef !== 'string' || secretRef.trim().length === 0) {
      return this.reject('must include a non-empty `secretRef` string');
    }

    return Promise.resolve();
  }

  private reject(detail: string): Promise<void> {
    return Promise.reject(new InvalidCredentialsShapeException(this.pluginName, detail));
  }
}
