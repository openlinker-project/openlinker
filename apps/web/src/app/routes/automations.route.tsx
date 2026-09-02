/**
 * Automations route (#2364)
 *
 * `/automations` (the trigger index), `/automations/:trigger` (that trigger's
 * rules), and `/automations/activity` (the run log, W2-48 — see the page's own
 * header for why it is registered now).
 *
 * `activity` is declared BEFORE `:trigger`, though React Router ranks static
 * segments above dynamic ones regardless. The order is kept explicit because
 * the two are indistinguishable to a reader otherwise, and a future rename of
 * the static path would silently start resolving as a trigger id.
 *
 * Every leaf carries its own crumb — the crumb-contract test asserts each lazy
 * leaf does, and a parent that only groups children has no semantic title.
 *
 * @module app/routes
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

const automationsIndexCrumb: RouteCrumbHandle = {
  crumb: { group: 'Operations', title: 'Automations' },
};

const automationActivityCrumb: RouteCrumbHandle = {
  crumb: { group: 'Operations', title: 'Run log' },
};

const automationTriggerCrumb: RouteCrumbHandle = {
  crumb: { group: 'Operations', title: 'Automation rules' },
};

export const automationsRoute: RouteObject = {
  path: 'automations',
  children: [
    {
      index: true,
      handle: automationsIndexCrumb,
      lazy: async () => {
        const { AutomationsPage } = await import('../../pages/automations/automations-page');
        return { Component: AutomationsPage };
      },
    },
    {
      path: 'activity',
      handle: automationActivityCrumb,
      lazy: async () => {
        const { AutomationActivityPage } = await import(
          '../../pages/automations/automation-activity-page'
        );
        return { Component: AutomationActivityPage };
      },
    },
    {
      path: ':trigger',
      handle: automationTriggerCrumb,
      lazy: async () => {
        const { AutomationTriggerPage } = await import(
          '../../pages/automations/automation-trigger-page'
        );
        return { Component: AutomationTriggerPage };
      },
    },
  ],
};
