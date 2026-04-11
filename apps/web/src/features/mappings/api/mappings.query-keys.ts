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
};
