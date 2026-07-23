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
});
