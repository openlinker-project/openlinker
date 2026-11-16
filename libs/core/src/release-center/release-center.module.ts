/**
 * Release Center Module (core)
 *
 * A LEAF: imports no sibling core context and speaks no HTTP. It provides the
 * two services and binds the repository tokens (persistence slice
 * #4141, with the ORM entities and `TypeOrmModule.forFeature`).
 *
 * @module libs/core/src/release-center
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReleaseCursorService } from './application/services/release-cursor.service';
import { ReleaseItemStateService } from './application/services/release-item-state.service';
import { ReleaseItemStateOrmEntity } from './infrastructure/persistence/entities/release-item-state.orm-entity';
import { UserReleaseStateOrmEntity } from './infrastructure/persistence/entities/user-release-state.orm-entity';
import { ReleaseCursorRepository } from './infrastructure/persistence/repositories/release-cursor.repository';
import { ReleaseItemStateRepository } from './infrastructure/persistence/repositories/release-item-state.repository';
import {
  RELEASE_CENTER_CURSOR_REPOSITORY_TOKEN,
  RELEASE_CENTER_ITEM_STATE_REPOSITORY_TOKEN,
  RELEASE_CENTER_CURSOR_SERVICE_TOKEN,
  RELEASE_CENTER_ITEM_STATE_SERVICE_TOKEN,
} from './release-center.tokens';

@Module({
  imports: [TypeOrmModule.forFeature([UserReleaseStateOrmEntity, ReleaseItemStateOrmEntity])],
  providers: [
    ReleaseCursorRepository,
    { provide: RELEASE_CENTER_CURSOR_REPOSITORY_TOKEN, useExisting: ReleaseCursorRepository },
    ReleaseItemStateRepository,
    {
      provide: RELEASE_CENTER_ITEM_STATE_REPOSITORY_TOKEN,
      useExisting: ReleaseItemStateRepository,
    },
    ReleaseCursorService,
    { provide: RELEASE_CENTER_CURSOR_SERVICE_TOKEN, useExisting: ReleaseCursorService },
    ReleaseItemStateService,
    { provide: RELEASE_CENTER_ITEM_STATE_SERVICE_TOKEN, useExisting: ReleaseItemStateService },
  ],
  exports: [RELEASE_CENTER_CURSOR_SERVICE_TOKEN, RELEASE_CENTER_ITEM_STATE_SERVICE_TOKEN],
})
export class ReleaseCenterModule {}
