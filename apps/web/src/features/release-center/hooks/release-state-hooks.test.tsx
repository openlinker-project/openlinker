import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { act, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../shared/api/api-error';
import type { SessionUser } from '../../../shared/auth/session.types';
import { createReleaseStateApi } from '../api/release-state.api';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../../test/test-utils';
import { isCursorWriteRejected, markCursorWriteRejected } from './release-cursor-write-memory';
import { useReleaseStateQuery } from './use-release-state-query';
import { useReleaseStepsMutation } from './use-release-steps-mutation';

const baseUser: SessionUser = {
  id: 'u1',
  username: 'u',
  email: 'u@example.com',
  role: 'viewer',
  permissions: [],
  analyticsConsent: true,
};

function Probe(): ReactElement {
  const query = useReleaseStateQuery();
  const steps = useReleaseStepsMutation();
  return (
    <button onClick={() => steps.mutate([{ itemKey: 'x', status: 'done', doneVia: 'manual' }])}>
      {query.fetchStatus}
    </button>
  );
}

describe('createReleaseStateApi', () => {
  it('should answer a disabled state when the read is 404 or 5xx', async () => {
    for (const status of [404, 500]) {
      const api = createReleaseStateApi(() => Promise.reject(new ApiError('x', status, null)));
      expect((await api.getState()).enabled).toBe(false);
    }
  });

  it('should rethrow other read errors', async () => {
    const api = createReleaseStateApi(() => Promise.reject(new ApiError('x', 403, null)));
    await expect(api.getState()).rejects.toBeInstanceOf(ApiError);
  });
});

describe('release center request gating', () => {
  it('should issue no request for an anonymous session', async () => {
    const getState = vi.fn();
    renderWithProviders(<Probe />, { apiClient: createMockApiClient({ releaseState: { getState } }) });
    await screen.findByRole('button');
    expect(getState).not.toHaveBeenCalled();
  });

  it('should issue no request for a packer', async () => {
    const getState = vi.fn();
    renderWithProviders(<Probe />, {
      apiClient: createMockApiClient({ releaseState: { getState } }),
      sessionAdapter: createAuthenticatedSessionAdapter({
        ...baseUser,
        role: 'packer',
        permissions: ['bench:write'],
      }),
    });
    await screen.findByRole('button');
    expect(getState).not.toHaveBeenCalled();
  });

  it('should read for a viewer but never call PUT steps', async () => {
    const getState = vi.fn().mockResolvedValue({ enabled: true, cursor: null, user: [], installation: [] });
    const updateSteps = vi.fn();
    renderWithProviders(<Probe />, {
      apiClient: createMockApiClient({ releaseState: { getState, updateSteps } }),
      sessionAdapter: createAuthenticatedSessionAdapter({
        ...baseUser,
        permissions: ['fulfillment:read'],
      }),
    });
    await waitFor(() => expect(getState).toHaveBeenCalled());
    await act(async () => {
      screen.getByRole('button').click();
    });
    expect(updateSteps).not.toHaveBeenCalled();
  });
});

describe('cursor write memory', () => {
  it('should remember a rejected version in memory', () => {
    markCursorWriteRejected('0.20.0');
    expect(isCursorWriteRejected('0.20.0')).toBe(true);
  });
});

describe('browser storage ban', () => {
  it('should not reference localStorage or sessionStorage in release-center sources', () => {
    const root = join(__dirname, '..');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
          // The message store is the one place allowed to touch browser storage (ADR-086 amendment, #4244);
          // an ESLint override scopes the same exception to that single file.
          if (name === 'notification-store.ts') continue;
          if (/(localStorage|sessionStorage)/.test(readFileSync(full, 'utf8'))) offenders.push(full);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
