/**
 * Release Item State Service
 *
 * Validates a batch at the boundary the ports cannot see (key shape, status
 * per scope, batch size, duplicates), orders it by key so concurrent batches
 * lock rows in one order, and hands it to the repository.
 *
 * @module libs/core/src/release-center/application/services
 */
import { Inject, Injectable } from '@nestjs/common';
import type { ReleaseItemState } from '../../domain/entities/release-center.entity';
import { InvalidReleaseStateError } from '../../domain/exceptions/release-center.exceptions';
import { ReleaseItemStateRepositoryPort } from '../../domain/ports/release-item-state-repository.port';
import {
  INSTALLATION_ITEM_STATE_LIMIT,
  InstallationItemStatusValues,
  RELEASE_STATE_BATCH_MAX,
  USER_ITEM_STATE_LIMIT,
  UserItemStatusValues,
  isReleaseDoneVia,
  isReleaseItemKey,
  type ReleaseItemStateChange,
} from '../../domain/types/release-center.types';
import { RELEASE_CENTER_ITEM_STATE_REPOSITORY_TOKEN } from '../../release-center.tokens';
import type {
  IReleaseItemStateService,
  ReleaseStateSnapshot,
} from './release-item-state.service.interface';

@Injectable()
export class ReleaseItemStateService implements IReleaseItemStateService {
  constructor(
    @Inject(RELEASE_CENTER_ITEM_STATE_REPOSITORY_TOKEN)
    private readonly repository: ReleaseItemStateRepositoryPort
  ) {}

  async getSnapshot(userId: string): Promise<ReleaseStateSnapshot> {
    const [user, installation] = await Promise.all([
      this.repository.listForUser(userId),
      this.repository.listInstallation(),
    ]);
    return { user, installation };
  }

  async applyUserStates(
    userId: string,
    changes: readonly ReleaseItemStateChange[]
  ): Promise<ReleaseItemState[]> {
    const ordered = this.validate(changes, UserItemStatusValues);
    return this.repository.upsertUserStates(userId, ordered, USER_ITEM_STATE_LIMIT);
  }

  async applyInstallationStates(
    actedByUserId: string,
    changes: readonly ReleaseItemStateChange[]
  ): Promise<ReleaseItemState[]> {
    const ordered = this.validate(changes, InstallationItemStatusValues);
    return this.repository.upsertInstallationStates(
      actedByUserId,
      ordered,
      INSTALLATION_ITEM_STATE_LIMIT
    );
  }

  private validate(
    changes: readonly ReleaseItemStateChange[],
    allowed: readonly string[]
  ): ReleaseItemStateChange[] {
    if (changes.length === 0 || changes.length > RELEASE_STATE_BATCH_MAX) {
      throw new InvalidReleaseStateError(
        'changes',
        `A batch holds 1 to ${RELEASE_STATE_BATCH_MAX} changes`
      );
    }
    const seen = new Set<string>();
    for (const change of changes) {
      if (!isReleaseItemKey(change.itemKey)) {
        throw new InvalidReleaseStateError('itemKey', `Invalid item key: ${String(change.itemKey)}`);
      }
      if (seen.has(change.itemKey)) {
        throw new InvalidReleaseStateError('itemKey', `Duplicate item key: ${change.itemKey}`);
      }
      seen.add(change.itemKey);
      if (!allowed.includes(change.status)) {
        throw new InvalidReleaseStateError(
          'status',
          `Status ${String(change.status)} is not valid in this scope`
        );
      }
      if (change.doneVia != null && !isReleaseDoneVia(change.doneVia)) {
        throw new InvalidReleaseStateError('doneVia', `Invalid doneVia: ${String(change.doneVia)}`);
      }
      if (change.status === 'snoozed' && !change.snoozedUntil) {
        throw new InvalidReleaseStateError('snoozedUntil', 'A snoozed item needs snoozedUntil');
      }
    }
    return [...changes]
      .sort((a, b) => (a.itemKey < b.itemKey ? -1 : 1))
      .map((c) => ({
        itemKey: c.itemKey,
        status: c.status,
        doneVia: c.status === 'done' ? (c.doneVia ?? null) : null,
        snoozedUntil: c.status === 'snoozed' ? (c.snoozedUntil ?? null) : null,
      }));
  }
}
