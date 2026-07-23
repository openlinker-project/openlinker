import { describe, expect, it } from 'vitest';
import { DemoEventCatalog } from './demo-events';

describe('DemoEventCatalog', () => {
  it('should have at least one event entry', () => {
    expect(Object.keys(DemoEventCatalog).length).toBeGreaterThan(0);
  });

  it('should give every entry a non-empty description and group', () => {
    for (const entry of Object.values(DemoEventCatalog)) {
      expect(entry.description.length).toBeGreaterThan(0);
      expect(entry.group.length).toBeGreaterThan(0);
    }
  });

  it('should give every entry runtime-inspectable prop keys (#1787 settings panel introspection)', () => {
    // `props` is typed via `{} as { ... }` casts, so nothing at compile time
    // stops a future entry from reverting to a bare `{}` placeholder — which
    // would silently make the /settings read-only catalog show "props:
    // (none)" for that event. Every entry declaring a non-empty props type
    // must carry matching non-empty runtime keys.
    for (const entry of Object.values(DemoEventCatalog)) {
      expect(Object.keys(entry.props).length).toBeGreaterThan(0);
    }
  });
});
