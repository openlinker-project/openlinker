/**
 * Saved Views Module (core)
 *
 * NestJS module for the saved-views context - a LEAF: it imports no sibling
 * core context and speaks no HTTP. Static `@Module`, the `operational-settings`
 * shape. `TypeOrmModule.forFeature` is mandatory: runtime entity discovery is
 * `autoLoadEntities`, so without it the tables never materialise in the
 * `synchronize`-built dev/test schema.
 *
 * @module libs/core/src/saved-views
 */
import type { DynamicModule, Type } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SavedViewsService } from './application/services/saved-views.service';
import { SavedViewDefaultOrmEntity } from './infrastructure/persistence/entities/saved-view-default.orm-entity';
import { SavedViewOrmEntity } from './infrastructure/persistence/entities/saved-view.orm-entity';
import { SavedViewRepository } from './infrastructure/persistence/repositories/saved-view.repository';
import type { SavedViewDefinitionPolicyPort } from './domain/ports/saved-view-definition-policy.port';
import {
  SAVED_VIEW_DEFINITION_POLICY_TOKEN,
  SAVED_VIEW_REPOSITORY_TOKEN, SAVED_VIEWS_SERVICE_TOKEN,
} from './saved-views.tokens';

/**
 * The host MUST import this through `forRoot(policy)`. A bare import fails at
 * boot (the service's policy dependency is unresolved) - deliberately not
 * `@Optional`: a host that forgot would silently accept unvalidated filter
 * queries, including a `search` carrying PII.
 */
@Module({
  imports: [TypeOrmModule.forFeature([SavedViewOrmEntity, SavedViewDefaultOrmEntity])],
  providers: [
    SavedViewRepository,
    { provide: SAVED_VIEW_REPOSITORY_TOKEN, useExisting: SavedViewRepository },
    SavedViewsService,
    { provide: SAVED_VIEWS_SERVICE_TOKEN, useExisting: SavedViewsService },
  ],
  exports: [SAVED_VIEW_REPOSITORY_TOKEN, SAVED_VIEWS_SERVICE_TOKEN],
})
export class SavedViewsModule {
  static forRoot(policy: Type<SavedViewDefinitionPolicyPort>): DynamicModule {
    return {
      module: SavedViewsModule,
      providers: [policy, { provide: SAVED_VIEW_DEFINITION_POLICY_TOKEN, useExisting: policy }],
    };
  }
}
