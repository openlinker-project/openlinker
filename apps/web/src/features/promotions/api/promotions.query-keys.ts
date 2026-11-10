export const promotionsQueryKeys = {
  all: ['promotions'] as const,
  list: () => ['promotions', 'list'] as const,
  one: (id: string) => ['promotions', 'one', id] as const,
  history: (id: string) => ['promotions', 'history', id] as const,
};
