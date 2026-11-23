/**
 * Release state API client (#4146, ADR-086)
 *
 * `GET /release-state` and the three PUTs. A 404 or a 5xx on the read means
 * "the feature is not available here" and is answered with a disabled state
 * rather than thrown, so a deployment whose API predates the feature simply
 * shows nothing.
 *
 * @module features/release-center/api
 */
import { ApiError } from '../../../shared/api/api-error';
import {
  parseCursorResult,
  parseReleaseItems,
  parseReleaseState,
} from './release-state.schema';
import type {
  InstallationReleaseItemChange,
  ReleaseItemState,
  ReleaseState,
  UpdateReleaseCursorInput,
  UpdateReleaseCursorResult,
  UserReleaseItemChange,
} from './release-state.types';

export interface ReleaseStateApi {
  getState: () => Promise<ReleaseState>;
  updateCursor: (input: UpdateReleaseCursorInput) => Promise<UpdateReleaseCursorResult>;
  updateItems: (changes: readonly UserReleaseItemChange[]) => Promise<ReleaseItemState[]>;
  updateSteps: (changes: readonly InstallationReleaseItemChange[]) => Promise<ReleaseItemState[]>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

export const DISABLED_RELEASE_STATE: ReleaseState = {
  enabled: false,
  cursor: null,
  user: [],
  installation: [],
};

export function createReleaseStateApi(request: ApiRequest): ReleaseStateApi {
  const put = <T>(path: string, body: unknown): Promise<T> =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) });

  return {
    async getState(): Promise<ReleaseState> {
      try {
        return parseReleaseState(await request<unknown>('/release-state'));
      } catch (error) {
        if (error instanceof ApiError && (error.status === 404 || error.status >= 500)) {
          return DISABLED_RELEASE_STATE;
        }
        throw error;
      }
    },
    async updateCursor(input): Promise<UpdateReleaseCursorResult> {
      return parseCursorResult(await put<unknown>('/release-state/cursor', input));
    },
    async updateItems(changes): Promise<ReleaseItemState[]> {
      return parseReleaseItems(await put<unknown>('/release-state/items', { changes }));
    },
    async updateSteps(changes): Promise<ReleaseItemState[]> {
      return parseReleaseItems(await put<unknown>('/release-state/steps', { changes }));
    },
  };
}
