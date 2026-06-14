/**
 * Erli Connection Config Shape Validator
 *
 * Validates the non-secret config for an Erli connection. Erli needs no
 * required config (the API key lives in credentials), so an empty config is
 * valid; the only constraint is that the optional `baseUrl` override, when
 * present, is a non-empty https URL. Registered against
 * `ConnectionConfigShapeValidatorRegistryService` at `erli.shopapi.v1`;
 * `ConnectionService` maps the thrown exception to a 400 at the API boundary.
 *
 * Hand-rolled (no class-validator) — one optional field doesn't justify a DTO
 * graph, and Erli stays dependency-light.
 *
 * @module libs/integrations/erli/src/infrastructure/adapters
 * @see {@link ConnectionConfigShapeValidatorPort}
 */
import {
  type ConnectionConfigShapeValidatorPort,
  type FlatValidationIssue,
  InvalidConnectionConfigException,
} from '@openlinker/core/integrations';

export class ErliConnectionConfigShapeValidatorAdapter
  implements ConnectionConfigShapeValidatorPort
{
  constructor(private readonly pluginName: string = 'Erli') {}

  validate(config: Record<string, unknown>): Promise<void> {
    const issues: FlatValidationIssue[] = [];
    const baseUrl = config.baseUrl;

    if (baseUrl !== undefined) {
      if (typeof baseUrl !== 'string' || baseUrl.trim().length === 0) {
        issues.push({ path: 'baseUrl', message: 'must be a non-empty string when provided' });
      } else if (!this.isHttpsUrl(baseUrl)) {
        issues.push({ path: 'baseUrl', message: 'must be a valid https URL' });
      }
    }

    if (issues.length > 0) {
      return Promise.reject(new InvalidConnectionConfigException(this.pluginName, issues));
    }
    return Promise.resolve();
  }

  private isHttpsUrl(value: string): boolean {
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  }
}
