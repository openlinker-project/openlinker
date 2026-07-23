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

  // Events genuinely carrying zero props (typed `Record<string, never>`) —
  // legitimately empty at runtime, not a regression of the invariant below.
  const NO_PROPS_EVENTS = new Set<string>([
    'demo_product_row_expanded',
    'demo_orders_viewed',
    'demo_order_opened',
    'demo_invoice_issue_attempted',
  ]);

  it('should give every non-empty-typed entry runtime-inspectable prop keys (#1787 settings panel introspection)', () => {
    // `props` is typed via `{} as { ... }` casts, so nothing at compile time
    // stops a future entry from reverting to a bare `{}` placeholder — which
    // would silently make the /settings read-only catalog show "props:
    // (none)" for that event. Every entry declaring a non-empty props type
    // must carry matching non-empty runtime keys; entries in NO_PROPS_EVENTS
    // are exempt since an empty object is the correct runtime shape there.
    for (const [name, entry] of Object.entries(DemoEventCatalog)) {
      if (NO_PROPS_EVENTS.has(name)) {
        expect(Object.keys(entry.props).length).toBe(0);
        continue;
      }
      expect(Object.keys(entry.props).length).toBeGreaterThan(0);
    }
  });
});
