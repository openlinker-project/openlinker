/**
 * Release Cursor Service
 *
 * @module libs/core/src/release-center/application/services
 */
import { Inject, Injectable } from '@nestjs/common';
import type { UserReleaseState } from '../../domain/entities/release-center.entity';
import { InvalidReleaseVersionError } from '../../domain/exceptions/release-center.exceptions';
import { ReleaseCursorRepositoryPort } from '../../domain/ports/release-cursor-repository.port';
import { parseReleaseVersion } from '../../domain/types/release-center.types';
import { RELEASE_CENTER_CURSOR_REPOSITORY_TOKEN } from '../../release-center.tokens';
import type {
  IReleaseCursorService,
  ReleaseCursorUpdate,
} from './release-cursor.service.interface';

@Injectable()
export class ReleaseCursorService implements IReleaseCursorService {
  constructor(
    @Inject(RELEASE_CENTER_CURSOR_REPOSITORY_TOKEN)
    private readonly repository: ReleaseCursorRepositoryPort
  ) {}

  getState(userId: string): Promise<UserReleaseState | null> {
    return this.repository.findByUserId(userId);
  }

  async advance(userId: string, version: string): Promise<ReleaseCursorUpdate> {
    const parsed = parseReleaseVersion(version);
    if (!parsed) throw new InvalidReleaseVersionError(String(version));
    return this.repository.advanceCursor(userId, parsed);
  }

  setSkipDialog(userId: string, skipDialog: boolean): Promise<UserReleaseState> {
    return this.repository.setSkipDialog(userId, skipDialog);
  }
}
