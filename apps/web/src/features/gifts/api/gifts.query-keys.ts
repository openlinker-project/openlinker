export const giftsQueryKeys = {
  all: ['gifts'] as const,
  attention: (orderId: string) => ['gifts', 'attention', orderId] as const,
};
