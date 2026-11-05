/**
 * Attribute projection summary (#3995)
 *
 * Pure readers over one variant's attribute projection preview: which
 * parameters the operator's rules fill, which rule-or-mapping values the
 * destination will not accept, and the operator-facing sentence naming where a
 * value came from. Shared by the Review step and the edit modal so both
 * describe a rule-filled value the same way.
 *
 * @module apps/web/src/features/listings/lib
 */
import type {
  AttributeProjectionPreviewEntry,
  ProjectedParameterOrigin,
} from '../api/listings.types';

export interface ProjectionSummary {
  /** Values a rule produced that the destination accepts - sent at publish. */
  ruleFilled: ProjectedParameterOrigin[];
  /** Values a rule or mapping produced that the destination will drop. */
  rejected: ProjectedParameterOrigin[];
  /** Origin per parameter id, for the edit modal's per-field explanation. */
  byParameterId: ReadonlyMap<string, ProjectedParameterOrigin>;
}

/**
 * Summarize a variant's preview, or `null` when there is nothing trustworthy to
 * say: no entry, a failed entry, or an entry computed for a different category
 * than the one the variant will now submit under (a rule may be scoped to the
 * old one).
 */
export function summarizeProjection(
  entry: AttributeProjectionPreviewEntry | undefined,
  submitCategoryId: string | null,
): ProjectionSummary | null {
  if (!entry || entry.status !== 'ok' || entry.categoryId !== submitCategoryId) return null;
  const ruleFilled: ProjectedParameterOrigin[] = [];
  const rejected: ProjectedParameterOrigin[] = [];
  const byParameterId = new Map<string, ProjectedParameterOrigin>();
  for (const origin of entry.origins) {
    byParameterId.set(origin.parameterId, origin);
    if (origin.outcome === 'rejected') rejected.push(origin);
    else if (origin.source === 'rule') ruleFilled.push(origin);
  }
  return { ruleFilled, rejected, byParameterId };
}

const PLACE_SOURCE_LABEL: Record<NonNullable<ProjectedParameterOrigin['rule']>['placeSource'] & string, string> = {
  name: 'product name',
  variant: 'variant name',
  manufacturer: 'manufacturer',
  ean: 'EAN',
  sku: 'SKU',
  weight: 'weight',
};

/** Where a projected value came from, as one short operator-facing phrase. */
export function describeOrigin(origin: ProjectedParameterOrigin): string {
  if (origin.source === 'mapping') return 'From your attribute mapping';
  const rule = origin.rule;
  switch (rule?.kind) {
    case 'fixed':
      return 'Fixed value from your attribute rules';
    case 'copy-remap':
      return rule.remapped
        ? `Copied from "${rule.sourceAttributeKey ?? '?'}" and translated by your attribute rules`
        : `Copied from "${rule.sourceAttributeKey ?? '?'}" by your attribute rules`;
    case 'place-value':
      return `Product ${rule.placeSource ? PLACE_SOURCE_LABEL[rule.placeSource] : 'field'}, placed by your attribute rules`;
    default:
      return 'From your attribute rules';
  }
}

/** Comma-joined parameter names, capped so a tooltip stays one line. */
export function listParameterNames(origins: readonly ProjectedParameterOrigin[], cap = 4): string {
  const names = origins.map((o) => o.parameterName);
  if (names.length <= cap) return names.join(', ');
  return `${names.slice(0, cap).join(', ')} and ${names.length - cap} more`;
}
