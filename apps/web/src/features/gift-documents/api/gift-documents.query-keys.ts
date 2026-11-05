/**
 * Gift documents - query key factory (#3941)
 *
 * @module apps/web/src/features/gift-documents/api
 */
export const giftDocumentsQueryKeys = {
  all: ['gift-documents'] as const,
  settings: () => ['gift-documents', 'settings'] as const,
  providers: () => ['gift-documents', 'providers'] as const,
};
