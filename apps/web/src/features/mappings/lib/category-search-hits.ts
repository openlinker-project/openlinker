/**
 * Category search hit adapters (#2075)
 *
 * The seam between the feature's `CategorySearchHit` and the shared
 * `CategorySearchResultHit` the presentational primitive declares locally
 * (`shared/ui` may not import a feature type — frontend-architecture.md
 * §Dependency Rules). Lives here, in the feature, because that is the side of
 * the boundary allowed to know both shapes.
 *
 * One home for the mapping so the three pickers cannot drift when the hit
 * shape grows a field.
 *
 * @module apps/web/src/features/mappings/lib
 */
import type { CategorySearchResultHit } from '../../../shared/ui/category-search-results';
import type { CategorySearchHit } from '../api/mappings.types';

export function toCategorySearchResultHits(
  hits: readonly CategorySearchHit[] | undefined,
): CategorySearchResultHit[] {
  return (hits ?? []).map((hit) => ({
    id: hit.category.id,
    name: hit.category.name,
    leaf: hit.category.leaf,
    path: hit.path,
  }));
}

/**
 * Whether an empty search result means "this taxonomy has never synced" rather
 * than "nothing matched".
 *
 * Both come back as an empty array, so the caller supplies what it knows about
 * the *browse* side. Three inputs, and the third is the one that is easy to
 * forget: a browse that **errored** also leaves zero nodes and no loading flag,
 * and reporting that as "never synced" would tell the operator something false
 * about their own catalogue — the same defect class #2075 exists to remove. A
 * failed browse therefore falls through to "no matches", the weaker claim.
 */
export function isTaxonomyUnsynced(input: {
  atRoot: boolean;
  browsedNodeCount: number;
  isBrowseLoading: boolean;
  browseError: unknown;
}): boolean {
  return (
    input.atRoot &&
    input.browsedNodeCount === 0 &&
    !input.isBrowseLoading &&
    input.browseError == null
  );
}
