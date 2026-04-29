export const allegroQueryKeys = {
  all: ['allegro'] as const,
  responsibleProducers: (connectionId: string) =>
    ['allegro', 'responsible-producers', connectionId] as const,
};
