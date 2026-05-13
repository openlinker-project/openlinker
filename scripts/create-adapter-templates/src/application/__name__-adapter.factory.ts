/**
 * __Name__ Adapter Factory
 *
 * Per-connection factory for __Name__ capability adapters. Implements
 * the plugin's `I__Name__AdapterFactory` interface; called by
 * `create__Name__Plugin`'s `createCapabilityAdapter` once you wire your
 * first capability.
 *
 * Scaffolded as a stub. As you implement capabilities:
 *   1. Add per-capability adapter classes under `infrastructure/adapters/`.
 *   2. Resolve `Connection.config` via a class-validator DTO (see
 *      PrestaShop's `prestashop-connection-config.dto.ts` for the
 *      canonical pattern).
 *   3. Resolve credentials via `credentialsResolver.get<__Name__Credentials>(
 *      connection.credentialsRef)` inside `createAdapters` — per-connection,
 *      NOT in the factory constructor.
 *   4. Construct each capability adapter with the resolved config + creds.
 *
 * See `docs/plugin-author-guide.md` § Step 5 and
 * `libs/integrations/prestashop/src/application/prestashop-adapter.factory.ts`
 * for a worked example.
 *
 * @module libs/integrations/__name__/src/application
 */
import { Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type {
  I__Name__AdapterFactory,
  __Name__Adapters,
} from './interfaces/__name__-adapter.factory.interface';

@Injectable()
export class __Name__AdapterFactory implements I__Name__AdapterFactory {
  private readonly logger = new Logger(__Name__AdapterFactory.name);

  createAdapters(
    connection: Connection,
    _identifierMapping: IdentifierMappingPort,
    _credentialsResolver: CredentialsResolverPort,
  ): Promise<__Name__Adapters> {
    this.logger.debug(
      `Creating __Name__ adapters for connection: ${connection.id}`,
    );
    // Replace this rejection with the real implementation as you wire
    // capabilities. See PrestaShop's factory for the canonical async/await
    // shape (config validation → credentials resolution → adapter
    // construction).
    return Promise.reject(
      new Error(
        '__Name__AdapterFactory.createAdapters is not implemented. ' +
          'See docs/plugin-author-guide.md § Step 5 for the implementation recipe.',
      ),
    );
  }
}
