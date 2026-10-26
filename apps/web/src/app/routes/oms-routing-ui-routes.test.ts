/**
 * OMS routing UI route gating (#3634)
 *
 * `/inventory/locations` and `/settings/sourcing-rules` are registered only
 * when `VITE_OL_OMS_ROUTING_UI_ENABLED` is `'true'`.
 *
 * @module app/routes
 */
import type { RouteObject } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { resolveOmsRoutingUiEnabled } from '../../shared/config/oms-routing-ui';
import { buildCoreChildren, coreChildren } from './root.route';

const OMS_ROUTING_PATHS = ['inventory/locations', 'settings/sourcing-rules'];

function paths(routes: RouteObject[]): string[] {
  return routes.map((route) => route.path).filter((path): path is string => path !== undefined);
}

describe('OMS routing UI flag', () => {
  it.each([
    [undefined, false],
    ['', false],
    ['false', false],
    ['TRUE', false],
    ['1', false],
    ['true', true],
  ])('should resolve %j to %s', (raw, expected) => {
    expect(resolveOmsRoutingUiEnabled(raw)).toBe(expected);
  });
});

describe('OMS routing UI routes', () => {
  it('should not register the OMS routing pages when the flag is off', () => {
    const registered = paths(buildCoreChildren(false));
    for (const path of OMS_ROUTING_PATHS) {
      expect(registered).not.toContain(path);
    }
  });

  it('should register the OMS routing pages when the flag is on', () => {
    const registered = paths(buildCoreChildren(true));
    for (const path of OMS_ROUTING_PATHS) {
      expect(registered).toContain(path);
    }
  });

  it('should withhold the OMS routing pages in the default build', () => {
    expect(paths(coreChildren)).toEqual(paths(buildCoreChildren(false)));
  });
});
