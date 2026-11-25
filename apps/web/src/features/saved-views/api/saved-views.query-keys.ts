/**
 * Saved Views - Query Key Factory
 *
 * @module apps/web/src/features/saved-views/api
 */
export const savedViewsQueryKeys = {
  all: ['saved-views'] as const,
  list: (pageKey: string) => ['saved-views', 'list', pageKey] as const,
};
