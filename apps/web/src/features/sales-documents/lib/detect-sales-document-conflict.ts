/**
 * Detect Sales Document Conflict (#2159)
 *
 * Display-only mirror of `resolveSalesDocumentRouting`'s ambiguity check
 * (`@openlinker/core/sales-documents`, ADR-041 decision 6) — surfaces the
 * SAME "no unambiguous primary" fact the backend resolver would hit, so an
 * operator sees it before it silently blocks auto-issuance. This function is
 * NOT the enforcement: the write-path guard (#2157) and the resolver itself
 * are the actual guarantee. It exists only so the centralized table can
 * render the alert the mockup's "Conflict state" panel calls for, for a
 * conflict that originated outside this page (a hand-edited config, a race
 * between two sessions, a migration).
 *
 * @module apps/web/src/features/sales-documents/lib
 */
import type { SalesDocumentRow } from '../api/sales-documents.types';

export type SalesDocumentConflictKind = 'multiple-primaries' | 'ambiguous-no-primary';

/**
 * `null` = no conflict — either zero/one routing candidate (a single
 * candidate wins outright regardless of its primary flag, mirroring the
 * resolver's single-candidate rule), or exactly one primary among several.
 *
 * Only `active` connections count as candidates (review finding 8): the
 * actual runtime gate (`AutoIssueTriggerService`, D8) only ever lists
 * `status: 'active'` connections, so a disabled or `needs_reauth` connection
 * with a configured `documentKind` can never actually compete for the
 * "primary" slot at runtime. Counting it here would show a legal-sounding
 * conflict banner for a state that cannot happen.
 */
export function detectSalesDocumentConflict(
  rows: readonly SalesDocumentRow[],
): SalesDocumentConflictKind | null {
  const eligible = rows.filter((row) => row.status === 'active' && row.documentKind !== null);
  if (eligible.length <= 1) return null;

  const primaries = eligible.filter((row) => row.isPrimary);
  if (primaries.length > 1) return 'multiple-primaries';
  if (primaries.length === 0) return 'ambiguous-no-primary';
  return null;
}
