/**
 * Cursors API Module
 *
 * NestJS module for cursor read API endpoints. Imports core sync module
 * (which provides the cursor repository) and registers the cursors controller.
 *
 * @module apps/api/src/cursors
 */
import { Module } from '@nestjs/common';
import { SyncModule as CoreSyncModule } from '@openlinker/core/sync';
import { CursorsController } from './http/cursors.controller';

@Module({
  imports: [CoreSyncModule],
  controllers: [CursorsController],
})
export class CursorsModule {}
