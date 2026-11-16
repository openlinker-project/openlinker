import { ReleaseCursorService } from './application/services/release-cursor.service';
import { ReleaseItemStateService } from './application/services/release-item-state.service';
import {
  InvalidReleaseStateError,
  InvalidReleaseVersionError,
} from './domain/exceptions/release-center.exceptions';
import type { ReleaseCursorRepositoryPort } from './domain/ports/release-cursor-repository.port';
import type { ReleaseItemStateRepositoryPort } from './domain/ports/release-item-state-repository.port';

describe('ReleaseCursorService', () => {
  const repo: jest.Mocked<ReleaseCursorRepositoryPort> = {
    findByUserId: jest.fn(),
    advanceCursor: jest.fn(),
    setSkipDialog: jest.fn(),
  };
  const service = new ReleaseCursorService(repo);

  it('should pass the parsed version to the repository when advancing', async () => {
    repo.advanceCursor.mockResolvedValue({ applied: true, state: {} as never });
    await service.advance('u1', '0.20.0');
    expect(repo.advanceCursor).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ major: 0, minor: 20, patch: 0, rank: 3_000_000 })
    );
  });

  it('should reject an unparseable version when advancing', async () => {
    await expect(service.advance('u1', 'latest')).rejects.toBeInstanceOf(
      InvalidReleaseVersionError
    );
  });
});

describe('ReleaseItemStateService', () => {
  const repo: jest.Mocked<ReleaseItemStateRepositoryPort> = {
    listInstallation: jest.fn(),
    listForUser: jest.fn(),
    upsertUserStates: jest.fn().mockResolvedValue([]),
    upsertInstallationStates: jest.fn().mockResolvedValue([]),
  };
  const service = new ReleaseItemStateService(repo);

  it('should sort a user batch by key when applying', async () => {
    await service.applyUserStates('u1', [
      { itemKey: 'b-step', status: 'archived' },
      { itemKey: 'a-step', status: 'deleted' },
    ]);
    const sent = repo.upsertUserStates.mock.calls[0][1];
    expect(sent.map((c) => c.itemKey)).toEqual(['a-step', 'b-step']);
    expect(repo.upsertUserStates.mock.calls[0][2]).toBe(500);
  });

  it('should refuse an installation status in the user scope when applying', async () => {
    await expect(
      service.applyUserStates('u1', [{ itemKey: 'a', status: 'done' }])
    ).rejects.toBeInstanceOf(InvalidReleaseStateError);
  });

  it('should refuse duplicates, bad keys and oversized batches when applying', async () => {
    await expect(
      service.applyUserStates('u1', [
        { itemKey: 'a', status: 'archived' },
        { itemKey: 'a', status: 'deleted' },
      ])
    ).rejects.toBeInstanceOf(InvalidReleaseStateError);
    await expect(
      service.applyUserStates('u1', [{ itemKey: 'Bad Key', status: 'archived' }])
    ).rejects.toBeInstanceOf(InvalidReleaseStateError);
    const many = Array.from({ length: 51 }, (_, i) => ({
      itemKey: `k${i}`,
      status: 'archived' as const,
    }));
    await expect(service.applyUserStates('u1', many)).rejects.toBeInstanceOf(
      InvalidReleaseStateError
    );
  });

  it('should require snoozedUntil when snoozing', async () => {
    await expect(
      service.applyUserStates('u1', [{ itemKey: 'a', status: 'snoozed' }])
    ).rejects.toBeInstanceOf(InvalidReleaseStateError);
  });

  it('should stamp the actor and normalise fields when applying installation states', async () => {
    await service.applyInstallationStates('admin', [
      { itemKey: 'x', status: 'done', doneVia: 'manual' },
    ]);
    expect(repo.upsertInstallationStates).toHaveBeenLastCalledWith(
      'admin',
      [{ itemKey: 'x', status: 'done', doneVia: 'manual', snoozedUntil: null }],
      2000
    );
  });
});
