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
import {
  interpolate,
  type Messages,
  type PluralFn,
  type PluralForms,
  type ResolvedCopy,
} from '../../../shared/i18n';
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

/** The `listings.attributeRules` copy, as `useMessages('listings')` resolves it. */
export type AttributeRulesCopy = ResolvedCopy<Messages['listings']>['attributeRules'];

/**
 * Where a projected value came from, as one short operator-facing phrase.
 * Copy is passed in rather than read here so this stays a pure function the
 * edit modal and its tests can call with whichever language is active.
 */
export function describeOrigin(
  origin: ProjectedParameterOrigin,
  copy: AttributeRulesCopy['origin'],
): string {
  if (origin.source === 'mapping') return copy.mapping;
  const rule = origin.rule;
  switch (rule?.kind) {
    case 'fixed':
      return copy.fixed;
    case 'copy-remap':
      return interpolate(rule.remapped ? copy.copiedTranslated : copy.copied, {
        attribute: rule.sourceAttributeKey ?? '?',
      });
    case 'place-value':
      return rule.placeSource
        ? interpolate(copy.placed, { field: copy.placeSource[rule.placeSource] })
        : copy.placedUnknown;
    default:
      return copy.rule;
  }
}

/** Comma-joined parameter names, capped so a tooltip stays one line. */
export function listParameterNames(
  origins: readonly ProjectedParameterOrigin[],
  more: PluralForms,
  plural: PluralFn,
  cap = 4,
): string {
  const names = origins.map((o) => o.parameterName);
  if (names.length <= cap) return names.join(', ');
  return plural(names.length - cap, more, { names: names.slice(0, cap).join(', ') });
}
