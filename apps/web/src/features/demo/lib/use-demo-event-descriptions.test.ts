import { describe, expect, it } from 'vitest';
import { getMessages } from '../../../shared/i18n';
import { DemoEventCatalog } from './demo-events';

describe('demo event descriptions', () => {
  it('should describe exactly the events in the catalog', () => {
    expect(Object.keys(getMessages('demo').events).sort()).toEqual(
      Object.keys(DemoEventCatalog).sort()
    );
  });

  it('should give every event a non-empty description', () => {
    for (const description of Object.values(getMessages('demo').events)) {
      expect(description.trim()).not.toBe('');
    }
  });
});
