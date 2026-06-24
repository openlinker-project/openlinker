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

    this.validateDispatchTime(config.defaultDispatchTime, issues);

    const callbackBaseUrl = config.callbackBaseUrl;
    if (callbackBaseUrl !== undefined) {
      // http allowed (dev: host.docker.internal); only require a parseable URL.
      if (typeof callbackBaseUrl !== 'string' || callbackBaseUrl.trim().length === 0) {
        issues.push({ path: 'callbackBaseUrl', message: 'must be a non-empty string when provided' });
      } else if (!this.isHttpUrl(callbackBaseUrl)) {
        issues.push({ path: 'callbackBaseUrl', message: 'must be a valid http(s) URL' });
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

  private isHttpUrl(value: string): boolean {
    try {
      const protocol = new URL(value).protocol;
      return protocol === 'https:' || protocol === 'http:';
    } catch {
      return false;
    }
  }

  /**
   * `defaultDispatchTime`, when present, must be `{ period: non-negative int,
   * unit?: 'hour' | 'day' | 'month' }` — the shape Erli's product create
   * requires. Absent is valid (per-offer override can supply it instead).
   */
  private validateDispatchTime(value: unknown, issues: FlatValidationIssue[]): void {
    if (value === undefined) {
      return;
    }
    if (typeof value !== 'object' || value === null) {
      issues.push({ path: 'defaultDispatchTime', message: 'must be an object when provided' });
      return;
    }
    const dt = value as { period?: unknown; unit?: unknown };
    if (typeof dt.period !== 'number' || !Number.isInteger(dt.period) || dt.period < 0) {
      issues.push({
        path: 'defaultDispatchTime.period',
        message: 'must be a non-negative integer',
      });
    }
    if (dt.unit !== undefined && !['hour', 'day', 'month'].includes(dt.unit as string)) {
      issues.push({
        path: 'defaultDispatchTime.unit',
        message: "must be 'hour', 'day', or 'month'",
      });
    }
  }
}
