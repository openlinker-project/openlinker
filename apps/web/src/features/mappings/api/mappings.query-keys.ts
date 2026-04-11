/**
 * Mappings Query Keys
 *
 * @module apps/web/src/features/mappings/api
 */

export const mappingsQueryKeys = {
  status: (connectionId: string) => ['mappings', connectionId, 'status'] as const,
  carriers: (connectionId: string) => ['mappings', connectionId, 'carriers'] as const,
  payments: (connectionId: string) => ['mappings', connectionId, 'payments'] as const,
  options: (connectionId: string) => ['mappings', connectionId, 'options'] as const,
  categories: (connectionId: string) => ['mappings', connectionId, 'categories'] as const,
  allegroCategories: (connectionId: string, parentId?: string) =>
    ['mappings', connectionId, 'allegro-categories', parentId ?? 'root'] as const,
};
