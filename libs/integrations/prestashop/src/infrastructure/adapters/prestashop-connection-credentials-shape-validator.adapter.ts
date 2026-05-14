/**
 * PrestaShop Connection Credentials Shape Validator Adapter (#586)
 *
 * Implements `ConnectionCredentialsShapeValidatorPort` for the PrestaShop
 * adapter. Verifies the raw credentials payload includes the mandatory
 * `webserviceApiKey` string before persistence. Semantics preserved from
 * the pre-#586 `validateCredentialsShape(platformType === 'prestashop', …)`
 * branch in `apps/api/src/integrations/application/credentials/`.
 *
 * Registered with `host.connectionCredentialsShapeValidatorRegistry` at
 * boot via `PrestashopIntegrationModule.onModuleInit` → `plugin.register(host)`.
 *
 * Allegro does NOT register a credentials shape validator — token shape
 * is enforced by `AllegroAdapterFactory.resolveCredentials` at adapter
 * construction time (deeper than this boundary).
 *
 * `pluginName` is injected via the constructor (sourced from the plugin
 * descriptor's brand constant) so the exception's display label stays
 * co-located with the manifest rather than hardcoded at every throw site.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters
 * @implements {ConnectionCredentialsShapeValidatorPort}
 */
import type { ConnectionCredentialsShapeValidatorPort } from '@openlinker/core/integrations';
import { InvalidCredentialsShapeException } from '@openlinker/core/integrations';

export class PrestashopConnectionCredentialsShapeValidatorAdapter
  implements ConnectionCredentialsShapeValidatorPort
{
  constructor(private readonly pluginName: string = 'PrestaShop') {}

  validate(credentials: Record<string, unknown>): Promise<void> {
    const key = credentials.webserviceApiKey;
    if (typeof key !== 'string' || key.trim().length === 0) {
      return Promise.reject(
        new InvalidCredentialsShapeException(
          this.pluginName,
          'must include a non-empty `webserviceApiKey` string'
        )
      );
    }
    return Promise.resolve();
  }
}
