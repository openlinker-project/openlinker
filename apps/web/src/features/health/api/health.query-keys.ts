export const healthQueryKeys = {
  all: ['health'] as const,
  devStack: () => ['health', 'dev-stack'] as const,
};
