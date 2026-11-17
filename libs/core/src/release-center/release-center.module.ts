/**
 * Release Center Module (core)
 *
 * A LEAF: imports no sibling core context and speaks no HTTP. It provides the
 * two services; the repository tokens are bound by the persistence slice
 * (#4141), which adds the ORM entities and `TypeOrmModule.forFeature`.
 *
 * @module libs/core/src/release-center
 */
import { Module } from '@nestjs/common';
import { ReleaseCursorService } from './application/services/release-cursor.service';
import { ReleaseItemStateService } from './application/services/release-item-state.service';
import {
  RELEASE_CENTER_CURSOR_SERVICE_TOKEN,
  RELEASE_CENTER_ITEM_STATE_SERVICE_TOKEN,
} from './release-center.tokens';

@Module({
  providers: [
    ReleaseCursorService,
    { provide: RELEASE_CENTER_CURSOR_SERVICE_TOKEN, useExisting: ReleaseCursorService },
    ReleaseItemStateService,
    { provide: RELEASE_CENTER_ITEM_STATE_SERVICE_TOKEN, useExisting: ReleaseItemStateService },
  ],
  exports: [RELEASE_CENTER_CURSOR_SERVICE_TOKEN, RELEASE_CENTER_ITEM_STATE_SERVICE_TOKEN],
})
export class ReleaseCenterModule {}
