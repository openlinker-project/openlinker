/**
 * Erli Connection Credentials Shape Validator
 *
 * Validates the credentials payload for an Erli connection: a single non-empty
 * `apiKey` string (ADR-025 static bearer key). Registered against
 * `ConnectionCredentialsShapeValidatorRegistryService` at `erli.shopapi.v1`;
 * `ConnectionService` maps the thrown exception to a 400 at the API boundary.
 *
 * Also enforces the optional `allegroClientId`/`allegroClientSecret` pair
 * (#1382/#1383, ADR-031) — the Allegro app credentials that enable the
 * category-catalog client-credentials flow. The two fields are "both or
 * neither": an incomplete pair can never authenticate against Allegro, so it's
 * a misconfiguration rather than a valid "catalog browsing disabled" state.
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
    const allegroPairError = this.validateAllegroCredentialPair(credentials);
    if (allegroPairError) {
      return Promise.reject(new InvalidCredentialsShapeException(this.pluginName, allegroPairError));
    }
    return Promise.resolve();
  }

  /**
   * `allegroClientId`/`allegroClientSecret` (#1382/#1383, ADR-031) must both be
   * present-and-non-empty, or both absent. Returns a message when the pair is
   * incomplete or malformed; `null` when it's valid (neither present, or both
   * present as non-empty strings).
   */
  private validateAllegroCredentialPair(credentials: Record<string, unknown>): string | null {
    const clientId = credentials.allegroClientId;
    const clientSecret = credentials.allegroClientSecret;
    const clientIdPresent = clientId !== undefined;
    const clientSecretPresent = clientSecret !== undefined;
    if (!clientIdPresent && !clientSecretPresent) {
      return null;
    }
    if (clientIdPresent && clientSecretPresent) {
      if (!this.isNonEmptyString(clientId) || !this.isNonEmptyString(clientSecret)) {
        return '`allegroClientId` and `allegroClientSecret` must both be non-empty strings when provided';
      }
      return null;
    }
    return 'must include both `allegroClientId` and `allegroClientSecret`, or neither';
  }

  private isNonEmptyString(value: unknown): boolean {
    return typeof value === 'string' && value.trim().length > 0;
  }
}
