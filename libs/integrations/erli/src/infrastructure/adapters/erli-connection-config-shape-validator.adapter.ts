/**
 * Erli Connection Config Shape Validator
 *
 * Validates the non-secret config for an Erli connection. Erli needs no
 * required config (the API key lives in credentials), so an empty config is
 * valid; the only constraint is that the optional `baseUrl` override, when
 * present, is a non-empty https URL targeting an Erli-owned host (SSRF guard —
 * the base URL carries the bearer key on every request). Registered against
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
import { ERLI_ALLOWED_BASE_URL_HOSTS, isAllowedErliHost } from '../../domain/policies/erli-base-url.policy';

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
      } else {
        const parsed = this.parseHttpsUrl(baseUrl);
        if (!parsed) {
          issues.push({ path: 'baseUrl', message: 'must be a valid https URL' });
        } else if (!isAllowedErliHost(parsed.hostname)) {
          issues.push({
            path: 'baseUrl',
            message: `host must be ${ERLI_ALLOWED_BASE_URL_HOSTS.join(' or ')} (or a subdomain)`,
          });
        }
      }
    }

    if (issues.length > 0) {
      return Promise.reject(new InvalidConnectionConfigException(this.pluginName, issues));
    }
    return Promise.resolve();
  }

  private parseHttpsUrl(value: string): URL | null {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' ? url : null;
    } catch {
      return null;
    }
  }
}
