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
import { messagesIn } from '../shared/i18n';
import type { NavContribution } from '../shared/plugins';

function toLiveNavItem(contribution: NavContribution): LiveNavItem {
  return {
    to: contribution.to,
    label: contribution.label,
    end: contribution.end,
  };
}

const englishSections = messagesIn('app', 'en').sections;

/**
 * Whether a contribution's `groupLabel` names this group. A base group's label
 * follows the active language, so the label alone stops matching once an
 * operator picks Polish: the group's section key (`'operations'`) and its
 * English label (`'Operations'`, what existing plugins pass) both match too.
 */
function matchesGroup(group: LiveNavGroup, groupLabel: string): boolean {
  if (group.label === groupLabel) return true;
  if (group.id === undefined) return false;
  return group.id === groupLabel || englishSections[group.id] === groupLabel;
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
        group.kind === 'live' && matchesGroup(group, contribution.groupLabel),
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
