/**
 * Master-Deletion Event Types — Drift Guard
 *
 * `'events.master.deletion'` exists as a literal in two places: the published
 * contract constant here (referenced from docs and used as the consumer's
 * `STREAM_NAME`) and the retention registry in `@openlinker/shared/redis`.
 *
 * They are deliberately not merged — `libs/shared/src/redis` also exports a
 * NestJS module, and a products-context domain *types* file should not pull that
 * in transitively. The cost of that separation is drift, and drift here fails
 * **silently**: a mismatch makes `resolveStreamBound` fall through to the
 * default, which today happens to carry the same 10 000 threshold, so nothing
 * would look wrong until someone tuned the registry entry and it quietly stopped
 * taking effect. This assertion is what makes that loud instead (#2163).
 *
 * @module libs/core/src/products/domain/types/__tests__
 */
import { REDIS_STREAM_NAMES } from '@openlinker/shared/redis';

import { MASTER_DELETION_EVENT_STREAM } from '../master-deletion-events.types';

describe('master-deletion event stream name', () => {
  it('should match the retention registry entry so the bound actually applies', () => {
    expect(MASTER_DELETION_EVENT_STREAM).toBe(REDIS_STREAM_NAMES.masterDeletion);
  });
});
