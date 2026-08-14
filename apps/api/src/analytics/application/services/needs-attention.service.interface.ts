/**
 * Needs Attention Service Interface
 *
 * Defines the contract for composing the three "needs attention" aggregates
 * (#1983) into one response.
 *
 * @module apps/api/src/analytics/application/services
 */
import type { NeedsAttentionSummary } from './needs-attention.types';

export const NEEDS_ATTENTION_SERVICE_TOKEN = Symbol('INeedsAttentionService');

export interface INeedsAttentionService {
  getSummary(): Promise<NeedsAttentionSummary>;
}
