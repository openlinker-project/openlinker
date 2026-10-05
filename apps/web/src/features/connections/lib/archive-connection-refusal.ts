/**
 * Archive refusal reader (#3657 review)
 *
 * Archiving answers 409 with `reason: 'master-catalog-referenced'` and the
 * `referrers` while another connection still uses this one as its catalog
 * (`config.masterCatalogConnectionId`). The archive dialog has to NAME those
 * connections: once archived, this connection vanishes from every list, so a
 * sentence that only says "something still uses it" would leave the operator
 * no way to find what to change.
 *
 * The reason value mirrors `ConnectionInUseReasonValues` in
 * `libs/core/src/identifier-mapping/domain/types/connection.types.ts` - the
 * browser bundle cannot import backend code (#591).
 *
 * @module apps/web/src/features/connections/lib
 */
import { ApiError } from '../../../shared/api/api-error';

export const MASTER_CATALOG_REFERENCED_REASON = 'master-catalog-referenced';

export interface ArchiveRefusalReferrer {
  id: string;
  name: string;
}

function isReferrer(value: unknown): value is ArchiveRefusalReferrer {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate['id'] === 'string' && typeof candidate['name'] === 'string';
}

/**
 * The connections still pairing their catalog with the one being archived, or
 * `null` when `error` is any other failure (the caller then shows the server's
 * message as before).
 */
export function readCatalogReferrers(error: unknown): ArchiveRefusalReferrer[] | null {
  if (!(error instanceof ApiError) || !error.isConflict()) return null;
  const details = error.details;
  if (typeof details !== 'object' || details === null) return null;
  const body = details as Record<string, unknown>;
  if (body['reason'] !== MASTER_CATALOG_REFERENCED_REASON) return null;
  const referrers = body['referrers'];
  if (!Array.isArray(referrers) || referrers.length === 0 || !referrers.every(isReferrer)) {
    return null;
  }
  return referrers;
}
