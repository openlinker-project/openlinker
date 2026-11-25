/**
 * Saved Views API Module
 *
 * Mounts the HTTP surface for named list views (#4241). Provides the page-aware
 * definition policy core requires - the one provider this module owns.
 *
 * @module apps/api/src/saved-views
 */
import { Module } from '@nestjs/common';
import { SavedViewsModule as CoreSavedViewsModule } from '@openlinker/core/saved-views';
import { SavedViewsController } from './http/saved-views.controller';
import { SavedViewDefinitionPolicy } from './saved-view-definition.policy';

@Module({
  imports: [CoreSavedViewsModule.forRoot(SavedViewDefinitionPolicy)],
  controllers: [SavedViewsController],
})
export class SavedViewsApiModule {}
