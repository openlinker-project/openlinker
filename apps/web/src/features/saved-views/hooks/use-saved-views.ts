/**
 * useSavedViews
 *
 * Server state for the named views of one list: read, create, update, delete,
 * set default. Owns no list state. A stale write (HTTP 409 on update) is
 * answered here once, with a toast that reloads the views, then rethrown so the
 * caller does not treat the change as saved.
 *
 * @module apps/web/src/features/saved-views/hooks
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useApiClient } from '../../../app/api/api-client-provider';
import { ApiError } from '../../../shared/api/api-error';
import { interpolate } from '../../../shared/i18n/interpolate';
import { useMessages } from '../../../shared/i18n/use-messages';
import { useToast } from '../../../shared/ui/toast-provider';
import { savedViewsQueryKeys } from '../api/saved-views.query-keys';
import type {
  CreateSavedViewInput,
  SavedView,
  UpdateSavedViewInput,
} from '../lib/saved-view.types';

export interface UseSavedViewsResult {
  views: SavedView[];
  isLoading: boolean;
  isError: boolean;
  create: (input: Omit<CreateSavedViewInput, 'pageKey'>) => Promise<SavedView>;
  update: (view: Pick<SavedView, 'id' | 'name'>, input: UpdateSavedViewInput) => Promise<SavedView>;
  remove: (id: string) => Promise<void>;
  /** `null` clears the personal default. */
  setDefault: (viewId: string | null) => Promise<void>;
  reload: () => Promise<void>;
}

const NO_VIEWS: SavedView[] = [];

/** A stale write: someone saved the view after this browser loaded it. */
export function isRevisionConflict(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === 'SAVED_VIEW_REVISION_CONFLICT' || (error.isConflict() && error.code === undefined))
  );
}

/** The name is already used by another view of this list. */
export function isNameTakenError(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'SAVED_VIEW_NAME_TAKEN';
}

export function useSavedViews(pageKey: string, enabled = true): UseSavedViewsResult {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const copy = useMessages('saved-views').errors;
  const key = savedViewsQueryKeys.list(pageKey);

  const query = useQuery({ queryKey: key, queryFn: () => apiClient.savedViews.list(pageKey), enabled });

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: savedViewsQueryKeys.all }),
    [queryClient],
  );

  // The cache is written straight away so the strip never shows a saved view
  // as edited against its own previous revision while the refetch is in flight.
  const patchCache = useCallback(
    (change: (rows: SavedView[]) => SavedView[]) =>
      queryClient.setQueryData<SavedView[]>(key, (rows) => change(rows ?? [])),
    [queryClient, key],
  );

  const createMutation = useMutation({
    mutationFn: (input: CreateSavedViewInput) => apiClient.savedViews.create(input),
    onSuccess: (created) => {
      patchCache((rows) => rows.concat(created));
      void invalidate();
    },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateSavedViewInput }) =>
      apiClient.savedViews.update(id, input),
    onSuccess: (updated) => {
      patchCache((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
      void invalidate();
    },
  });
  const removeMutation = useMutation({
    mutationFn: (id: string) => apiClient.savedViews.remove(id),
    onSuccess: (_result, id) => {
      patchCache((rows) => rows.filter((row) => row.id !== id));
      void invalidate();
    },
  });
  const defaultMutation = useMutation({
    mutationFn: (viewId: string | null) => apiClient.savedViews.setDefault({ pageKey, viewId }),
    onSuccess: invalidate,
  });

  const reload = useCallback(async () => {
    await invalidate();
  }, [invalidate]);

  const update = useCallback(
    async (view: Pick<SavedView, 'id' | 'name'>, input: UpdateSavedViewInput): Promise<SavedView> => {
      try {
        return await updateMutation.mutateAsync({ id: view.id, input });
      } catch (error) {
        if (isRevisionConflict(error)) {
          showToast({
            tone: 'warning',
            description: interpolate(copy.conflict, { name: view.name }),
            action: { label: copy.conflictAction, onClick: () => void reload() },
            durationMs: 10000,
          });
        }
        throw error;
      }
    },
    [copy.conflict, copy.conflictAction, reload, showToast, updateMutation],
  );

  const create = useCallback(
    (input: Omit<CreateSavedViewInput, 'pageKey'>) => createMutation.mutateAsync({ ...input, pageKey }),
    [createMutation, pageKey],
  );

  return {
    views: query.data ?? NO_VIEWS,
    isLoading: query.isLoading,
    isError: query.isError,
    create,
    update,
    remove: removeMutation.mutateAsync,
    setDefault: defaultMutation.mutateAsync,
    reload,
  };
}
