export const giftsQueryKeys = {
  all: ['gifts'] as const,
  rules: () => ['gifts', 'rules'] as const,
  attention: (orderId: string) => ['gifts', 'attention', orderId] as const,
};
