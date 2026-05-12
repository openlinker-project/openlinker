/**
 * mergePluginNavContributions
 *
 * Pure helper that folds plugin nav contributions into the host's static
 * nav groups. For each contribution: drop it if its `requiresRole` doesn't
 * match the session role (#610); otherwise find a `LiveNavGroup` whose
 * `label` matches `groupLabel` and append; otherwise create a new live group
 * at the end of the list. Group order is stable; within a group,
 * contributions are appended in registry order.
 *
 * Exported as a standalone module so the merge logic stays unit-testable
 * without booting the app shell.
 *
 * @module plugins
 */
import type { LiveNavGroup, LiveNavItem, NavGroup } from '../app/nav-registry.types';
import type { NavContribution } from './plugin.types';

function toLiveNavItem(contribution: NavContribution): LiveNavItem {
  return {
    to: contribution.to,
    label: contribution.label,
    end: contribution.end,
  };
}

export interface MergeNavContributionsOptions {
  /** Session role gate. Defaults to `false` so admin-only contributions are
   *  hidden unless the caller opts in. */
  isAdmin?: boolean;
}

export function mergePluginNavContributions(
  groups: NavGroup[],
  contributions: NavContribution[],
  options: MergeNavContributionsOptions = {},
): NavGroup[] {
  const isAdmin = options.isAdmin ?? false;

  const visibleContributions = contributions.filter((contribution) => {
    if (contribution.requiresRole === 'admin' && !isAdmin) return false;
    return true;
  });

  if (visibleContributions.length === 0) {
    return groups;
  }

  const result: NavGroup[] = groups.map((group) =>
    group.kind === 'live' ? { ...group, items: [...group.items] } : group,
  );

  for (const contribution of visibleContributions) {
    const item = toLiveNavItem(contribution);
    const target = result.find(
      (group): group is LiveNavGroup =>
        group.kind === 'live' && group.label === contribution.groupLabel,
    );

    if (target) {
      target.items.push(item);
      continue;
    }

    result.push({
      kind: 'live',
      label: contribution.groupLabel,
      items: [item],
    });
  }

  return result;
}
