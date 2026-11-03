/**
 * Stream Dead Letters — API Types
 *
 * A poison Redis Stream entry that exhausted recovery and was durably
 * dead-lettered rather than retried forever (#2301, D48). Read-only —
 * there is no replay action in this pass.
 *
 * @module apps/web/src/features/sync-jobs/api
 */

export interface StreamDeadLetter {
  id: string;
  stream: string;
  consumerGroup: string;
  entryId: string;
  rawFields: Record<string, string>;
  attempts: number;
  lastError: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface StreamDeadLetterFilters {
  stream?: string;
}

export interface StreamDeadLetterPagination {
  limit?: number;
  offset?: number;
}

export interface PaginatedStreamDeadLetters {
  items: StreamDeadLetter[];
  total: number;
  limit: number;
  offset: number;
}

export interface StreamDeadLettersCount {
  count: number;
}
