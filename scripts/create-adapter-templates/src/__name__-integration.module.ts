/**
 * __Name__ Integration Module
 *
 * NestJS host wrapper for the __Name__ plugin descriptor. Uses the
 * `createNestAdapterModule` helper from `@openlinker/plugin-sdk` — the
 * simple authoring pattern (#593) for plugins that don't yet need their
 * own NestJS providers.
 *
 * **When to graduate to the inline-from-module pattern**: as soon as
 * your plugin needs its own `@Injectable` providers — a TypeORM
 * repository, a provisioner, an HTTP client, a refresh service — swap
 * this file for the explicit `@Module() / onModuleInit` shape used by
 * `libs/integrations/prestashop/src/prestashop-integration.module.ts`
 * and `libs/integrations/allegro/src/allegro-integration.module.ts`.
 *
 * See `docs/plugin-author-guide.md` § Step 6 *Two authoring patterns*.
 *
 * @module libs/integrations/__name__/src
 */
import { createNestAdapterModule } from '@openlinker/plugin-sdk';
import { create__Name__Plugin } from './__name__-plugin';

export const __Name__IntegrationModule = createNestAdapterModule({
  plugin: create__Name__Plugin({}),
});
