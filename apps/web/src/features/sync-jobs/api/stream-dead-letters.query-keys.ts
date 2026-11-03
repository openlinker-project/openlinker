import type {
  StreamDeadLetterFilters,
  StreamDeadLetterPagination,
} from './stream-dead-letters.types';

export const streamDeadLettersQueryKeys = {
  all: ['stream-dead-letters'] as const,
  list: (filters?: StreamDeadLetterFilters, pagination?: StreamDeadLetterPagination) =>
    ['stream-dead-letters', 'list', filters ?? {}, pagination ?? {}] as const,
  count: (filters?: StreamDeadLetterFilters) =>
    ['stream-dead-letters', 'count', filters ?? {}] as const,
};
